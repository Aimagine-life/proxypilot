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
// Google's generate_204 — designed for connectivity checks (Android uses it),
// no rate limit, no body to parse, and a working proxy that passes here is
// likely to pass google.com / gemini.google.com too. Cloudflare trace was
// tried first but Cloudflare blocks many known free-proxy IPs at L7.
const VALIDATE_URL = 'https://www.google.com/generate_204';
const MAX_VALIDATE_ATTEMPTS = 15;
const BLOCKED_COUNTRIES = new Set(['RU', 'BY', 'CN', 'IR']);
export const DEAD_HOST_TTL_MS = 30 * 60 * 1000;

let memoryPool = null;
let memoryFetchedAt = 0;

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
    if (!host || !port || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (!['http', 'https', 'socks4', 'socks5'].includes(protocol)) continue;
    out.push({ host, port, protocol, country, score, anonymity });
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
  // Shuffle first (Fisher-Yates), then stable-sort by score DESC.
  // Result: highest-scoring proxies come first; ties are randomised across calls.
  for (let i = kept.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kept[i], kept[j]] = [kept[j], kept[i]];
  }
  kept.sort((a, b) => (b.score || 0) - (a.score || 0));
  return kept;
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
 * Fetch pool, filter by deadHosts from state.freeProxy, validate candidates
 * sequentially until one passes or MAX_VALIDATE_ATTEMPTS is exhausted.
 *
 * Does NOT mutate the passed-in state. Caller is responsible for writing
 * state.freeProxy.selected / deadHosts / poolFetchedAt based on the return value.
 *
 * Returns { pick, attemptedHosts, poolSize, error }.
 *   pick: { host, port, scheme, country, latencyMs, validatedAt } | null
 *   error: user-facing Russian string when pick is null.
 */
export async function pickAndValidate(state) {
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
  const candidates = filterPool(pool, { deadHosts }).slice(0, MAX_VALIDATE_ATTEMPTS);
  if (candidates.length === 0) {
    return {
      pick: null,
      attemptedHosts: [],
      poolSize: pool.length,
      error: 'нет подходящих кандидатов после фильтрации',
    };
  }

  const attempted = [];
  for (const cand of candidates) {
    attempted.push(`${cand.host}:${cand.port}`);
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
    error: `не нашли рабочий прокси (проверено ${attempted.length})`,
  };
}
