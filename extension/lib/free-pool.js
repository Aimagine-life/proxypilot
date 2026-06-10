// Free proxy pool — fetches several public proxy lists (see SOURCES), merges +
// dedupes them, filters, picks one, validates it by routing test traffic through
// Chrome's proxy. Used by the background service worker when
// state.proxySource === 'free'.
//
// Side effects:
//   - network fetches to the feeds in SOURCES
//   - temporary chrome.proxy.settings.set during validateProxy (restored on return)
//
// Three-tier cache (memory → chrome.storage → network) mirrors lib/rkn-check.js.

import { validateProxy as _validateProxy } from './proxy-backend.js';
export { validateProxy } from './proxy-backend.js';

const POOL_TTL_MS = 5 * 60 * 1000;
const POOL_CACHE_KEY = 'freeProxyPoolCache';
const FETCH_TIMEOUT_MS = 15_000;
const BLOCKED_COUNTRIES = new Set(['RU', 'BY', 'CN', 'IR']);
export const DEAD_HOST_TTL_MS = 30 * 60 * 1000;
// Cap how many candidates we probe per pick. Public free lists have hundreds of
// dead entries; at 4s each, probing them all would take many minutes. Candidates
// are pre-sorted (HTTPS-capable + trusted feeds first), so a live one is usually
// found early — this cap just bounds the worst case and lets us stop honestly.
export const MAX_VALIDATION_ATTEMPTS = 100;

let memoryPool = null;
let memoryFetchedAt = 0;

const VALID_PROTOCOLS = ['http', 'https', 'socks4', 'socks5'];
// Полные имена стран → ISO только для блокируемых (hideip отдаёт страну именем).
const BLOCKED_NAME_TO_ISO = { Russia: 'RU', Belarus: 'BY', China: 'CN', Iran: 'IR' };

/** Валидирует и нормализует одну запись. Возвращает NormalizedProxy или null. */
export function makeProxy({ host, port, protocol, country = null, score = 0, anonymity = null, https = false }) {
  const h = String(host == null ? '' : host).trim();
  const p = Number(port);
  if (!h || !Number.isInteger(p) || p < 1 || p > 65535) return null;
  const proto = String(protocol || '').toLowerCase();
  if (!VALID_PROTOCOLS.includes(proto)) return null;
  // SOCKS туннелирует любой TCP → HTTPS-способен; http — только если фид это явно подтвердил.
  const httpsCapable = https === true || proto === 'socks4' || proto === 'socks5';
  return {
    host: h, port: p, protocol: proto,
    country: country || null, score: Number(score) || 0,
    anonymity: anonymity || null, httpsCapable,
  };
}

/** JSON-массив ИЛИ объект ИЛИ NDJSON (по объекту на строку) → массив объектов. */
function parseJsonOrNdjson(text) {
  if (typeof text !== 'string') return [];
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try { const v = JSON.parse(trimmed); return Array.isArray(v) ? v : [v]; }
    catch { return []; }
  }
  if (trimmed.startsWith('{')) {
    // Одиночный объект-обёртка — попробовать как цельный JSON; при неудаче — NDJSON.
    try { return [JSON.parse(trimmed)]; } catch { /* fall through to NDJSON */ }
  }
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
  let data = parseJsonOrNdjson(text);
  // Развернуть обёртку {proxies:[...]} / {data:[...]}, если она пришла как единственный объект.
  if (data.length === 1 && !data[0]?.ip && (Array.isArray(data[0]?.proxies) || Array.isArray(data[0]?.data))) {
    data = data[0].proxies || data[0].data;
  }
  const arr = Array.isArray(data) ? data : [];
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
    const [host, rawPort = ''] = s.split(':');
    const port = rawPort.split(/[\s#]/)[0];
    const p = makeProxy({ host, port, protocol: proto });
    if (p) out.push(p);
  }
  return out;
}

/**
 * Объединённый пул из всех SOURCES. Трёхуровневый кэш: память → chrome.storage
 * → сеть. Кэш хранит УЖЕ нормализованный объединённый массив (не сырой JSON).
 * `force: true` пропускает оба кэша.
 */
export async function fetchPool({ force = false } = {}) {
  const now = Date.now();

  if (!force && memoryPool && (now - memoryFetchedAt) < POOL_TTL_MS) {
    return memoryPool;
  }

  if (!force) {
    try {
      const cached = (await chrome.storage.local.get(POOL_CACHE_KEY))[POOL_CACHE_KEY];
      // Принимаем только новый формат {pool, at}; старый {raw, at} игнорируем.
      if (cached && Array.isArray(cached.pool) && (now - cached.at) < POOL_TTL_MS) {
        memoryPool = cached.pool;
        memoryFetchedAt = cached.at;
        return memoryPool;
      }
    } catch (err) {
      console.warn('[FreePool] Cache read failed:', err.message);
    }
  }

  const pool = await fetchAllSources();
  memoryPool = pool;
  memoryFetchedAt = now;

  try {
    await chrome.storage.local.set({ [POOL_CACHE_KEY]: { pool, at: now } });
  } catch (err) {
    console.warn('[FreePool] Cache write failed:', err.message);
  }

  return memoryPool;
}

export const SOURCES = [
  { name: 'proxifly',    kind: 'proxifly',    url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.json' },
  { name: 'proxyscrape', kind: 'proxyscrape', url: 'https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/all/data.json' },
  { name: 'monosans',    kind: 'monosans',    url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies.json',          defaultScore: 60 },
  { name: 'zloi-http',   kind: 'hideip', proto: 'http',   url: 'https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt',   defaultScore: 55 },
  { name: 'zloi-socks5', kind: 'hideip', proto: 'socks5', url: 'https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt', defaultScore: 70 },
  { name: 'hookzof',     kind: 'txt',    proto: 'socks5', url: 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt', defaultScore: 50 },
];

const ADAPTERS = {
  proxifly: parseProxifly,
  proxyscrape: parseProxyscrape,
  monosans: parseMonosans,
  hideip: parseHideip,
  txt: parseTxt,
};

/**
 * Тянет все SOURCES параллельно (Promise.allSettled — падение одного фида не
 * роняет остальные), нормализует адаптером, применяет дефолтный score фида к
 * записям без score, сливает с дедупом. Бросает, только если упали ВСЕ источники.
 */
export async function fetchAllSources() {
  const settled = await Promise.allSettled(SOURCES.map(async (src) => {
    const res = await fetch(src.url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${src.name}: HTTP ${res.status}`);
    const text = await res.text();
    const parsed = ADAPTERS[src.kind](text, src.proto);
    if (src.defaultScore) for (const p of parsed) if (!p.score) p.score = src.defaultScore;
    return parsed;
  }));

  const merged = [];
  let okCount = 0;
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === 'fulfilled') { okCount++; merged.push(...settled[i].value); }
    else console.warn(`[FreePool] источник ${SOURCES[i].name} недоступен:`, settled[i].reason?.message || settled[i].reason);
  }
  if (okCount === 0) throw new Error('все источники недоступны');
  return dedupePool(merged);
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
 * Fetch pool, filter by deadHosts from state.freeProxy, validate candidates
 * sequentially until one passes or MAX_VALIDATION_ATTEMPTS is reached. Caller
 * can also interrupt by ignoring the response (popup closes, etc.).
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
    const result = await _validateProxy(cand);
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

/** Дедуп по protocol:host:port. При дубле: max score, OR httpsCapable, первое непустое country/anonymity. */
export function dedupePool(list) {
  const map = new Map();
  for (const p of list) {
    const key = `${p.protocol}:${p.host}:${p.port}`;
    const existing = map.get(key);
    if (!existing) { map.set(key, { ...p }); continue; }
    existing.score = Math.max(existing.score || 0, p.score || 0);
    existing.httpsCapable = existing.httpsCapable || p.httpsCapable;
    if (!existing.country && p.country) existing.country = p.country;
    if (!existing.anonymity && p.anonymity) existing.anonymity = p.anonymity;
  }
  return [...map.values()];
}
