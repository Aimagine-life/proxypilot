// Free proxy pool — fetches Proxifly's public list, filters, picks one,
// validates it by routing test traffic through Chrome's proxy. Used by the
// background service worker when state.proxySource === 'free'.
//
// Side effects:
//   - network fetch to Proxifly's GitHub raw URL
//   - temporary chrome.proxy.settings.set during validateProxy (restored on return)
//
// Three-tier cache (memory → chrome.storage → network) mirrors lib/rkn-check.js.

const POOL_URL = 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.json';
const POOL_TTL_MS = 5 * 60 * 1000;
const POOL_CACHE_KEY = 'freeProxyPoolCache';
const FETCH_TIMEOUT_MS = 15_000;
const VALIDATE_TIMEOUT_MS = 5_000;
// Provider-neutral captive-portal probe (tiny 200 body, no rate limit). We
// deliberately avoid Google's generate_204 (biases the pool toward proxies that
// can reach Google specifically — a universal router routes many non-Google
// services) and Cloudflare (it L7-blocks many free-proxy IPs). This just answers
// "is this proxy alive", which is what pool selection needs.
const VALIDATE_URL = 'https://detectportal.firefox.com/success.txt';
const BLOCKED_COUNTRIES = new Set(['RU', 'BY', 'CN', 'IR']);
export const DEAD_HOST_TTL_MS = 30 * 60 * 1000;
// Cap how many candidates we probe per pick. Public free lists can have hundreds
// of dead entries; at 5s each, probing them all would take ~30 min. Stop early
// and tell the user honestly instead.
export const MAX_VALIDATION_ATTEMPTS = 30;

let memoryPool = null;
let memoryFetchedAt = 0;

const VALID_PROTOCOLS = ['http', 'https', 'socks4', 'socks5'];
// Полные имена стран → ISO только для блокируемых (hideip отдаёт страну именем).
const BLOCKED_NAME_TO_ISO = { Russia: 'RU', Belarus: 'BY', China: 'CN', Iran: 'IR' };

/** Валидирует и нормализует одну запись. Возвращает NormalizedProxy или null. */
export function makeProxy({ host, port, protocol, country = null, score = 0, anonymity = null, https = false }) {
  const p = Number(port);
  if (!host || !Number.isInteger(p) || p < 1 || p > 65535) return null;
  const proto = String(protocol || '').toLowerCase();
  if (!VALID_PROTOCOLS.includes(proto)) return null;
  // SOCKS туннелирует любой TCP → HTTPS-способен; http — только если фид это явно подтвердил.
  const httpsCapable = https === true || proto === 'socks4' || proto === 'socks5';
  return {
    host: String(host), port: p, protocol: proto,
    country: country || null, score: Number(score) || 0,
    anonymity: anonymity || null, httpsCapable,
  };
}

/** JSON-массив ИЛИ NDJSON (по объекту на строку) → массив объектов. */
function parseJsonOrNdjson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  const out = [];
  for (const line of trimmed.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip malformed */ }
  }
  return out;
}

/** Proxifly: ip/port/protocol, geolocation.country||country (уже ISO), https, anonymity, score. */
export function parseProxifly(text) {
  const out = [];
  for (const e of parseJsonOrNdjson(text)) {
    const p = makeProxy({
      host: e?.ip, port: e?.port, protocol: e?.protocol,
      country: e?.geolocation?.country || e?.country || null,
      score: Number(e?.score) || 0,
      anonymity: e?.anonymity || null,
      https: e?.https === true,
    });
    if (p) out.push(p);
  }
  return out;
}

/** ProxyScrape (GitHub CDN): country=полное имя, ISO в country_code; ssl→https, uptime_percent→score. */
export function parseProxyscrape(text) {
  const data = parseJsonOrNdjson(text);
  const arr = Array.isArray(data) ? data : (data?.proxies || data?.data || []);
  const out = [];
  for (const e of arr) {
    const p = makeProxy({
      host: e?.ip, port: e?.port, protocol: e?.protocol,
      country: e?.country_code || null,
      score: Number(e?.uptime_percent) || 0,
      anonymity: e?.anonymity || null,
      https: e?.ssl === true,
    });
    if (p) out.push(p);
  }
  return out;
}

/** monosans: host/port/protocol, ISO в geolocation.country.iso_code; нет anonymity/ssl/score. */
export function parseMonosans(text) {
  const data = parseJsonOrNdjson(text);
  const arr = Array.isArray(data) ? data : [];
  const out = [];
  for (const e of arr) {
    const p = makeProxy({
      host: e?.host, port: e?.port, protocol: e?.protocol,
      country: e?.geolocation?.country?.iso_code || null,
    });
    if (p) out.push(p);
  }
  return out;
}

/** hideip.me: строки "ip:port:CountryName". Имя→ISO только для блокируемых, прочее→null. */
export function parseHideip(text, proto) {
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const parts = s.split(':');
    if (parts.length < 2) continue;
    const name = parts.slice(2).join(':').trim();
    const p = makeProxy({
      host: parts[0], port: parts[1], protocol: proto,
      country: BLOCKED_NAME_TO_ISO[name] || null,
    });
    if (p) out.push(p);
  }
  return out;
}

/** Чистый список "ip:port" (по строке). Протокол из аргумента, страна неизвестна. */
export function parseTxt(text, proto) {
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || !s.includes(':')) continue;
    const host = s.split(':')[0];
    const port = s.split(':')[1].split(/[\s#]/)[0];
    const p = makeProxy({ host, port, protocol: proto });
    if (p) out.push(p);
  }
  return out;
}

/**
 * Fetch the Proxifly pool. Three-tier cache: memory → chrome.storage → network.
 * Returns normalized array of { host, port, protocol, country, score, anonymity }.
 * `force: true` skips both caches.
 */
export async function fetchPool({ force = false } = {}) {
  const now = Date.now();

  if (!force && memoryPool && (now - memoryFetchedAt) < POOL_TTL_MS) {
    return memoryPool;
  }

  if (!force) {
    try {
      const cached = (await chrome.storage.local.get(POOL_CACHE_KEY))[POOL_CACHE_KEY];
      if (cached && (now - cached.at) < POOL_TTL_MS) {
        memoryPool = normalizePool(cached.raw);
        memoryFetchedAt = cached.at;
        return memoryPool;
      }
    } catch (err) {
      console.warn('[FreePool] Cache read failed:', err.message);
    }
  }

  const res = await fetch(POOL_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Proxifly fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  const raw = parseRaw(text);
  memoryPool = normalizePool(raw);
  memoryFetchedAt = now;

  try {
    await chrome.storage.local.set({ [POOL_CACHE_KEY]: { raw, at: now } });
  } catch (err) {
    console.warn('[FreePool] Cache write failed:', err.message);
  }

  return memoryPool;
}

/**
 * Parse Proxifly response. Supports JSON array OR NDJSON (one JSON object per line).
 */
function parseRaw(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  // NDJSON
  const out = [];
  for (const line of trimmed.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip malformed */ }
  }
  return out;
}

function normalizePool(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    const host = entry?.ip;
    const port = Number(entry?.port);
    const protocol = entry?.protocol;
    const country = entry?.geolocation?.country || entry?.country || null;
    const score = Number(entry?.score) || 0;
    const anonymity = entry?.anonymity || null;
    // Can this proxy tunnel HTTPS? Every routed site is HTTPS, so a proxy with
    // https:false is useless for us even when it's "alive". SOCKS proxies tunnel
    // any TCP, so treat them as HTTPS-capable regardless of the flag.
    const httpsCapable = entry?.https === true || protocol === 'socks4' || protocol === 'socks5';
    if (!host || !port || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (!['http', 'https', 'socks4', 'socks5'].includes(protocol)) continue;
    out.push({ host, port, protocol, country, score, anonymity, httpsCapable });
  }
  return out;
}

// Reset memory cache — used by tests. Not exported in production usage.
export function __resetMemoryCache() {
  memoryPool = null;
  memoryFetchedAt = 0;
}

/**
 * Filter a normalized pool. Drops:
 *   - entries whose country is in BLOCKED_COUNTRIES (RU/BY/CN/IR)
 *   - entries whose country is 'ZZ' (Proxifly's "unknown" — almost always dead)
 *   - entries with anonymity === 'transparent' (leak real IP, Google flags them)
 *   - entries in deadHosts (TTL pruned in-place)
 * Sorts kept entries by score DESC, then shuffles within equal-score tiers so
 * runs don't all hit the same top-scoring proxy.
 */
export function filterPool(pool, { deadHosts = {} } = {}) {
  const now = Date.now();
  // Prune expired dead entries
  for (const key of Object.keys(deadHosts)) {
    if (deadHosts[key] < now) delete deadHosts[key];
  }
  const kept = [];
  for (const entry of pool) {
    if (entry.country && BLOCKED_COUNTRIES.has(entry.country)) continue;
    if (entry.country === 'ZZ') continue;
    if (entry.anonymity === 'transparent') continue;
    const key = `${entry.host}:${entry.port}`;
    if (deadHosts[key]) continue;
    kept.push(entry);
  }
  // Shuffle (Fisher-Yates) so equal tiers vary across runs, then stable-sort:
  // HTTPS-capable first (a proxy that can't tunnel HTTPS is useless — every
  // routed site is HTTPS), then score DESC.
  for (let i = kept.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kept[i], kept[j]] = [kept[j], kept[i]];
  }
  kept.sort((a, b) =>
    (b.httpsCapable ? 1 : 0) - (a.httpsCapable ? 1 : 0)
    || (b.score || 0) - (a.score || 0));
  return kept;
}

/**
 * First proxy from `proxies` that isn't currently marked dead in `deadHosts`
 * (a { 'host:port': expiryTs } map). Used by the own-pool picker. Pure — no I/O.
 */
export function nextLiveProxy(proxies, deadHosts = {}, now = Date.now()) {
  return (proxies || []).find((p) => {
    if (!p || !p.host || !p.port) return false;
    const exp = deadHosts[`${p.host}:${p.port}`];
    return !(exp && exp > now);
  }) || null;
}

/**
 * Validate a proxy candidate by routing test traffic through it.
 * Temporarily replaces chrome.proxy.settings with PAC=ALL→candidate, fetches
 * Google's generate_204 endpoint (returns HTTP 204, no body), then clears
 * proxy settings.
 *
 * CALLER must restore the user's proxy via applyProxy(state) after this returns —
 * we only clear, we don't know what was there before. (In practice, the background
 * handler that calls us already does applyProxy on storage.onChanged.)
 */
export async function validateProxy(candidate) {
  const pac = buildAllThroughPac(candidate);
  await chrome.proxy.settings.set({
    value: { mode: 'pac_script', pacScript: { data: pac, mandatory: true } },
    scope: 'regular',
  });

  const start = Date.now();
  try {
    const res = await fetch(VALIDATE_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    // generate_204 returns 204 No Content. Accept anything 2xx; some proxies
    // may rewrite to 200 with empty body, which is still a working proxy.
    if (!res.ok) {
      return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    }
    return { ok: true, latencyMs, error: null };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: String(err?.message || err) };
  } finally {
    await chrome.proxy.settings.clear({ scope: 'regular' });
  }
}

function buildAllThroughPac({ host, port, protocol }) {
  let directive;
  switch (protocol) {
    case 'https':  directive = `HTTPS ${host}:${port}`; break;
    case 'socks5': directive = `SOCKS5 ${host}:${port}; SOCKS ${host}:${port}`; break;
    case 'socks4': directive = `SOCKS ${host}:${port}`; break;
    default:       directive = `PROXY ${host}:${port}`;
  }
  return `function FindProxyForURL(url, host) { return "${directive}"; }`;
}

/**
 * Fetch pool, filter by deadHosts from state.freeProxy, validate ALL filtered
 * candidates sequentially until one passes. No hard cap on attempts — caller
 * can interrupt by ignoring the response (popup closes, etc.).
 *
 * Does NOT mutate the passed-in state. Caller is responsible for writing
 * state.freeProxy.selected / deadHosts / poolFetchedAt based on the return value.
 *
 * `onProgress(index, total, candidate)` is invoked before each validateProxy
 * call so the caller can stream progress to the UI. Errors thrown by
 * onProgress are swallowed.
 *
 * Returns { pick, attemptedHosts, poolSize, error }.
 *   pick: { host, port, scheme, country, latencyMs, validatedAt } | null
 *   error: user-facing Russian string when pick is null.
 */
export async function pickAndValidate(state, { onProgress } = {}) {
  const deadHosts = (state.freeProxy && state.freeProxy.deadHosts) || {};
  let pool;
  try {
    pool = await fetchPool();
  } catch (err) {
    return {
      pick: null,
      attemptedHosts: [],
      poolSize: 0,
      error: `не удалось загрузить список: ${err.message}`,
    };
  }
  const candidates = filterPool(pool, { deadHosts });
  if (candidates.length === 0) {
    return {
      pick: null,
      attemptedHosts: [],
      poolSize: pool.length,
      error: 'В бесплатном списке нет подходящих прокси. Лучше укажи свой прокси.',
    };
  }

  // How many candidates can actually tunnel HTTPS? If none, the free list is
  // effectively useless right now — say so instead of probing for minutes.
  const httpsCapable = candidates.filter((c) => c.httpsCapable).length;

  const attempted = [];
  const limit = Math.min(candidates.length, MAX_VALIDATION_ATTEMPTS);
  for (let i = 0; i < limit; i++) {
    const cand = candidates[i];
    attempted.push(`${cand.host}:${cand.port}`);
    if (onProgress) {
      try { onProgress(i + 1, limit, cand); } catch { /* swallow — UI is best-effort */ }
    }
    const result = await validateProxy(cand);
    if (result.ok) {
      return {
        pick: {
          host: cand.host,
          port: cand.port,
          scheme: cand.protocol,
          country: cand.country || null,
          latencyMs: result.latencyMs,
          validatedAt: Date.now(),
        },
        attemptedHosts: attempted,
        poolSize: pool.length,
        error: null,
      };
    }
  }
  return {
    pick: null,
    attemptedHosts: attempted,
    poolSize: pool.length,
    error: httpsCapable === 0
      ? 'В бесплатном списке сейчас нет HTTPS-прокси — он почти бесполезен. Лучше укажи свой прокси.'
      : `Рабочий прокси не найден (проверено ${attempted.length}). Попробуй позже или укажи свой.`,
  };
}
