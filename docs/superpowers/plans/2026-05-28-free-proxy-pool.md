# Free Proxy Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Free-pool proxy source (Proxifly feed) alongside the existing Manual source. Lazy validation via Cloudflare trace, rotate-on-error via webRequest.onErrorOccurred, AI-account warning banner. Target v0.5.0.

**Architecture:** One new pure-ish module (`lib/free-pool.js`) handling fetch+cache+filter+validate. Additive changes to storage schema (v1→v2 migration), background message handlers, and popup UI. The existing `applyProxy` / PAC pipeline is **not modified** — `state.proxy` remains the single source of truth wired into Chrome; the new module just writes to it.

**Tech Stack:** Same as core — vanilla ES modules, MV3, no build step, no deps, tests via `node --test` (Node ≥ 20), `globalThis.chrome` mocking pattern.

**Spec reference:** [docs/superpowers/specs/2026-05-28-free-proxy-pool-design.md](../specs/2026-05-28-free-proxy-pool-design.md)

---

## Files this plan creates or modifies

```
gemini-unblock/
├── extension/
│   ├── manifest.json                    ← MODIFY: version 0.4.3 → 0.5.0
│   ├── background.js                    ← MODIFY: new handlers + onErrorOccurred
│   ├── lib/
│   │   ├── free-pool.js                 ← CREATE: fetchPool, filterPool, pickAndValidate, validateProxy
│   │   └── storage.js                   ← MODIFY: schema v2 migration
│   └── popup/
│       ├── popup.html                   ← MODIFY: source pills, free-block, AI-banner
│       ├── popup.css                    ← MODIFY: new styles
│       └── popup.js                     ← MODIFY: source toggle handlers, free-block render
└── tests/
    ├── free-pool.test.js                ← CREATE
    └── storage.test.js                  ← CREATE
```

---

## Task 1: `lib/free-pool.js` — fetch + filter + validate

Pure module with one network side-effect (`fetch`) and one Chrome side-effect (`chrome.proxy.settings.set` during validation, restored by caller). All tests run in Node with mocked `globalThis.fetch` and `globalThis.chrome`.

**Files:**
- Create: `extension/lib/free-pool.js`
- Create: `tests/free-pool.test.js`

### Step 1.1: Write the chrome+fetch mock helper test infrastructure

- [ ] Add the mock setup at the top of `tests/free-pool.test.js` (you'll use this in every test below):

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Reset before each test
let mockStorage;
let mockProxyConfig;
let mockFetchResponses;
let mockFetchCalls;

beforeEach(() => {
  mockStorage = {};
  mockProxyConfig = null;
  mockFetchResponses = [];   // queue: each call shifts one
  mockFetchCalls = [];

  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: mockStorage[key] }),
        set: async (obj) => { Object.assign(mockStorage, obj); },
      },
    },
    proxy: {
      settings: {
        set: async (cfg) => { mockProxyConfig = cfg; },
        clear: async () => { mockProxyConfig = null; },
      },
    },
  };

  globalThis.fetch = async (url, opts) => {
    mockFetchCalls.push({ url, opts });
    const resp = mockFetchResponses.shift();
    if (!resp) throw new Error(`unexpected fetch: ${url}`);
    if (resp instanceof Error) throw resp;
    return resp;
  };
});

function mockResponse({ ok = true, status = 200, text = '', json = null } = {}) {
  return {
    ok,
    status,
    text: async () => text,
    json: async () => json,
  };
}
```

- [ ] Save the file. No need to run yet (no tests in it yet).

### Step 1.2: Write the first failing test — `fetchPool` parses Proxifly JSON array

- [ ] Append to `tests/free-pool.test.js`:

```js
import { fetchPool } from '../extension/lib/free-pool.js';

const SAMPLE_POOL = [
  { proxy: 'socks5://1.2.3.4:1080', protocol: 'socks5', ip: '1.2.3.4', port: 1080, geolocation: { country: 'NL' } },
  { proxy: 'http://5.6.7.8:8080',   protocol: 'http',   ip: '5.6.7.8', port: 8080, geolocation: { country: 'DE' } },
  { proxy: 'socks4://9.9.9.9:1234', protocol: 'socks4', ip: '9.9.9.9', port: 1234, geolocation: { country: 'US' } },
];

test('fetchPool: parses Proxifly JSON array', async () => {
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(SAMPLE_POOL) }));
  const pool = await fetchPool({ force: true });
  assert.equal(pool.length, 3);
  assert.deepEqual(pool[0], { host: '1.2.3.4', port: 1080, protocol: 'socks5', country: 'NL' });
  assert.deepEqual(pool[1], { host: '5.6.7.8', port: 8080, protocol: 'http',   country: 'DE' });
});
```

### Step 1.3: Run the test, confirm it fails

- [ ] Run from repo root:

```bash
cd c:/Users/Konstantin/projects/gemini-unblock && node --test tests/free-pool.test.js
```

- [ ] Expected: failure with `Cannot find module '../extension/lib/free-pool.js'` or similar import error.

### Step 1.4: Create `lib/free-pool.js` skeleton with constants and `fetchPool`

- [ ] Create `extension/lib/free-pool.js`:

```js
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
const VALIDATE_TIMEOUT_MS = 3_000;
const VALIDATE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';
const MAX_VALIDATE_ATTEMPTS = 10;
const BLOCKED_COUNTRIES = new Set(['RU', 'BY', 'CN', 'IR']);
const DEAD_HOST_TTL_MS = 30 * 60 * 1000;

let memoryPool = null;
let memoryFetchedAt = 0;

/**
 * Fetch the Proxifly pool. Three-tier cache: memory → chrome.storage → network.
 * Returns normalized array of { host, port, protocol, country }.
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
    } catch { /* fall through to network */ }
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
  } catch { /* not fatal */ }

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
    if (!host || !port || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (!['http', 'https', 'socks4', 'socks5'].includes(protocol)) continue;
    out.push({ host, port, protocol, country });
  }
  return out;
}

// Reset memory cache — used by tests. Not exported in production usage.
export function __resetMemoryCache() {
  memoryPool = null;
  memoryFetchedAt = 0;
}
```

### Step 1.5: Run the test, confirm it passes

- [ ] Run:

```bash
node --test tests/free-pool.test.js
```

- [ ] Expected: 1 pass. If failure, fix and re-run.

### Step 1.6: Add test for NDJSON parsing

- [ ] Append to `tests/free-pool.test.js`:

```js
import { __resetMemoryCache } from '../extension/lib/free-pool.js';

test('fetchPool: parses NDJSON', async () => {
  __resetMemoryCache();
  const ndjson = SAMPLE_POOL.map((e) => JSON.stringify(e)).join('\n');
  mockFetchResponses.push(mockResponse({ text: ndjson }));
  const pool = await fetchPool({ force: true });
  assert.equal(pool.length, 3);
  assert.equal(pool[0].host, '1.2.3.4');
});
```

- [ ] Run: `node --test tests/free-pool.test.js` → 2 passes.

### Step 1.7: Add tests for normalization edge cases

- [ ] Append:

```js
test('fetchPool: drops entries missing ip or port', async () => {
  __resetMemoryCache();
  const data = [
    { proxy: 'http://x:80', protocol: 'http', port: 80, geolocation: { country: 'US' } },        // no ip
    { proxy: 'http://1.2.3.4', protocol: 'http', ip: '1.2.3.4', geolocation: { country: 'US' } }, // no port
    { proxy: 'http://1.2.3.4:abc', protocol: 'http', ip: '1.2.3.4', port: 'abc', geolocation: { country: 'US' } },
    { proxy: 'http://1.2.3.4:99999', protocol: 'http', ip: '1.2.3.4', port: 99999, geolocation: { country: 'US' } },
    { proxy: 'http://1.2.3.4:8080', protocol: 'http', ip: '1.2.3.4', port: 8080, geolocation: { country: 'US' } },
  ];
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(data) }));
  const pool = await fetchPool({ force: true });
  assert.equal(pool.length, 1);
  assert.equal(pool[0].host, '1.2.3.4');
});

test('fetchPool: drops unknown protocol', async () => {
  __resetMemoryCache();
  const data = [
    { protocol: 'foobar', ip: '1.2.3.4', port: 80, geolocation: { country: 'US' } },
    { protocol: 'socks5', ip: '5.6.7.8', port: 1080, geolocation: { country: 'US' } },
  ];
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(data) }));
  const pool = await fetchPool({ force: true });
  assert.equal(pool.length, 1);
  assert.equal(pool[0].protocol, 'socks5');
});
```

- [ ] Run: `node --test tests/free-pool.test.js` → 4 passes.

### Step 1.8: Add caching tests

- [ ] Append:

```js
test('fetchPool: memory cache returns same data without fetch on second call', async () => {
  __resetMemoryCache();
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(SAMPLE_POOL) }));
  await fetchPool({ force: true });
  assert.equal(mockFetchCalls.length, 1);
  await fetchPool();                      // no force, should hit memory
  assert.equal(mockFetchCalls.length, 1); // still 1
});

test('fetchPool: chrome.storage cache used on cold memory', async () => {
  __resetMemoryCache();
  mockStorage['freeProxyPoolCache'] = { raw: SAMPLE_POOL, at: Date.now() - 60_000 };
  const pool = await fetchPool();          // no force
  assert.equal(mockFetchCalls.length, 0);  // didn't hit network
  assert.equal(pool.length, 3);
});

test('fetchPool: expired chrome.storage cache → network fetch', async () => {
  __resetMemoryCache();
  mockStorage['freeProxyPoolCache'] = { raw: SAMPLE_POOL, at: Date.now() - (6 * 60 * 1000) }; // 6 min > 5 min TTL
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(SAMPLE_POOL) }));
  await fetchPool();
  assert.equal(mockFetchCalls.length, 1);
});
```

- [ ] Run: `node --test tests/free-pool.test.js` → 7 passes.

### Step 1.9: Add `filterPool` — write failing test first

- [ ] Append:

```js
import { filterPool } from '../extension/lib/free-pool.js';

const BIG_POOL = [
  { host: '1.1.1.1', port: 80, protocol: 'http', country: 'NL' },
  { host: '2.2.2.2', port: 80, protocol: 'http', country: 'RU' },   // blocked country
  { host: '3.3.3.3', port: 80, protocol: 'http', country: 'BY' },   // blocked country
  { host: '4.4.4.4', port: 80, protocol: 'http', country: 'CN' },   // blocked country
  { host: '5.5.5.5', port: 80, protocol: 'http', country: 'IR' },   // blocked country
  { host: '6.6.6.6', port: 80, protocol: 'http', country: 'DE' },
  { host: '7.7.7.7', port: 80, protocol: 'http', country: null },   // unknown — kept
  { host: '8.8.8.8', port: 80, protocol: 'http', country: 'US' },
];

test('filterPool: drops blocked countries', () => {
  const filtered = filterPool(BIG_POOL, { deadHosts: {} });
  const countries = new Set(filtered.map((p) => p.country));
  assert.equal(countries.has('RU'), false);
  assert.equal(countries.has('BY'), false);
  assert.equal(countries.has('CN'), false);
  assert.equal(countries.has('IR'), false);
  assert.equal(filtered.length, 4); // NL, DE, null, US
});

test('filterPool: drops dead hosts and prunes expired ones', () => {
  const now = Date.now();
  const deadHosts = {
    '1.1.1.1:80': now + 60_000,          // alive in dead-list
    '6.6.6.6:80': now - 60_000,          // expired
  };
  const filtered = filterPool(BIG_POOL, { deadHosts });
  const hosts = new Set(filtered.map((p) => p.host));
  assert.equal(hosts.has('1.1.1.1'), false);  // still dead
  assert.equal(hosts.has('6.6.6.6'), true);   // expired → resurrected
  assert.equal(deadHosts['6.6.6.6:80'], undefined); // pruned in-place
  assert.equal(deadHosts['1.1.1.1:80'], now + 60_000); // not pruned
});
```

- [ ] Run: `node --test tests/free-pool.test.js` → 2 new failures (`filterPool is not defined`).

### Step 1.10: Implement `filterPool`

- [ ] Append to `extension/lib/free-pool.js`:

```js
/**
 * Filter a normalized pool: drop BLOCKED_COUNTRIES and entries in deadHosts.
 * Mutates deadHosts to prune expired entries (TTL check). Returns a SHUFFLED
 * copy of the kept entries.
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
    const key = `${entry.host}:${entry.port}`;
    if (deadHosts[key]) continue;
    kept.push(entry);
  }
  // Fisher-Yates shuffle
  for (let i = kept.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kept[i], kept[j]] = [kept[j], kept[i]];
  }
  return kept;
}
```

- [ ] Run: `node --test tests/free-pool.test.js` → 9 passes.

### Step 1.11: Add `validateProxy` — failing test first

- [ ] Append:

```js
import { validateProxy } from '../extension/lib/free-pool.js';

const CF_TRACE = `fl=123f456
h=www.cloudflare.com
ip=185.123.45.67
ts=1716902400.123
visit_scheme=https
uag=Mozilla/5.0
colo=AMS
sliver=none
http=http/2
loc=NL
tls=TLSv1.3
sni=plaintext
warp=off
gateway=off
rbi=off
kex=X25519`;

test('validateProxy: success → ok=true, parses ip/loc', async () => {
  mockFetchResponses.push(mockResponse({ text: CF_TRACE }));
  const result = await validateProxy({ host: '1.2.3.4', port: 1080, protocol: 'socks5' });
  assert.equal(result.ok, true);
  assert.equal(result.country, 'NL');
  assert.equal(typeof result.latencyMs, 'number');
  assert.ok(result.latencyMs >= 0);
  assert.equal(result.error, null);
});

test('validateProxy: sets and clears chrome.proxy.settings', async () => {
  mockFetchResponses.push(mockResponse({ text: CF_TRACE }));
  await validateProxy({ host: '1.2.3.4', port: 1080, protocol: 'socks5' });
  // After the call, mockProxyConfig should be null (cleared) — we restored.
  assert.equal(mockProxyConfig, null);
});

test('validateProxy: fetch throws → ok=false with error', async () => {
  mockFetchResponses.push(new Error('connection refused'));
  const result = await validateProxy({ host: '1.2.3.4', port: 1080, protocol: 'socks5' });
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.equal(mockProxyConfig, null); // still cleared
});

test('validateProxy: non-2xx response → ok=false', async () => {
  mockFetchResponses.push(mockResponse({ ok: false, status: 502, text: '' }));
  const result = await validateProxy({ host: '1.2.3.4', port: 1080, protocol: 'socks5' });
  assert.equal(result.ok, false);
});
```

- [ ] Run: → 4 new failures.

### Step 1.12: Implement `validateProxy`

- [ ] Append to `extension/lib/free-pool.js`:

```js
/**
 * Validate a proxy candidate by routing test traffic through it.
 * Temporarily replaces chrome.proxy.settings with PAC=ALL→candidate, fetches
 * Cloudflare's trace endpoint, parses ip/loc, then clears proxy settings.
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
    if (!res.ok) {
      return { ok: false, latencyMs, country: null, error: `HTTP ${res.status}` };
    }
    const text = await res.text();
    const country = parseTrace(text, 'loc');
    const ip = parseTrace(text, 'ip');
    if (!ip) {
      return { ok: false, latencyMs, country: null, error: 'malformed trace' };
    }
    return { ok: true, latencyMs, country, ip, error: null };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, country: null, error: String(err?.message || err) };
  } finally {
    await chrome.proxy.settings.clear({ scope: 'regular' });
  }
}

function parseTrace(text, key) {
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq) === key) return line.slice(eq + 1).trim();
  }
  return null;
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
```

- [ ] Run: → 13 passes.

### Step 1.13: Add `pickAndValidate` — failing tests first

- [ ] Append:

```js
import { pickAndValidate } from '../extension/lib/free-pool.js';

test('pickAndValidate: first candidate alive → returns it', async () => {
  __resetMemoryCache();
  const onePool = [{ proxy: 'socks5://1.2.3.4:1080', protocol: 'socks5', ip: '1.2.3.4', port: 1080, geolocation: { country: 'NL' } }];
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(onePool) }));  // pool fetch
  mockFetchResponses.push(mockResponse({ text: CF_TRACE }));                  // validate
  const result = await pickAndValidate({ freeProxy: { deadHosts: {} } });
  assert.equal(result.pick.host, '1.2.3.4');
  assert.equal(result.pick.scheme, 'socks5');
  assert.equal(result.pick.country, 'NL');
  assert.equal(result.error, null);
  assert.equal(result.poolSize, 1);
});

test('pickAndValidate: first 2 dead, 3rd alive → returns 3rd', async () => {
  __resetMemoryCache();
  // Force a known order by stubbing Math.random to always return 0 (no shuffle).
  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    const pool = [
      { protocol: 'socks5', ip: '1.1.1.1', port: 1080, geolocation: { country: 'NL' } },
      { protocol: 'socks5', ip: '2.2.2.2', port: 1080, geolocation: { country: 'NL' } },
      { protocol: 'socks5', ip: '3.3.3.3', port: 1080, geolocation: { country: 'NL' } },
    ];
    mockFetchResponses.push(mockResponse({ text: JSON.stringify(pool) }));
    mockFetchResponses.push(new Error('dead 1'));
    mockFetchResponses.push(new Error('dead 2'));
    mockFetchResponses.push(mockResponse({ text: CF_TRACE }));
    const result = await pickAndValidate({ freeProxy: { deadHosts: {} } });
    assert.equal(result.pick.host, '3.3.3.3');
    assert.equal(result.attemptedHosts.length, 3);
  } finally {
    Math.random = origRandom;
  }
});

test('pickAndValidate: all dead → null pick + error', async () => {
  __resetMemoryCache();
  const pool = [
    { protocol: 'socks5', ip: '1.1.1.1', port: 1080, geolocation: { country: 'NL' } },
    { protocol: 'socks5', ip: '2.2.2.2', port: 1080, geolocation: { country: 'NL' } },
  ];
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(pool) }));
  mockFetchResponses.push(new Error('dead'));
  mockFetchResponses.push(new Error('dead'));
  const result = await pickAndValidate({ freeProxy: { deadHosts: {} } });
  assert.equal(result.pick, null);
  assert.match(result.error, /no working/i);
  assert.equal(result.attemptedHosts.length, 2);
});

test('pickAndValidate: empty filtered pool → null pick with specific error', async () => {
  __resetMemoryCache();
  const pool = [
    { protocol: 'socks5', ip: '1.1.1.1', port: 1080, geolocation: { country: 'RU' } }, // all blocked
  ];
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(pool) }));
  const result = await pickAndValidate({ freeProxy: { deadHosts: {} } });
  assert.equal(result.pick, null);
  assert.match(result.error, /pool is empty/i);
});
```

- [ ] Run: → 4 new failures.

### Step 1.14: Implement `pickAndValidate`

- [ ] Append to `extension/lib/free-pool.js`:

```js
/**
 * Fetch pool, filter by deadHosts from state.freeProxy, validate candidates
 * sequentially until one passes or MAX_VALIDATE_ATTEMPTS is exhausted.
 *
 * Does NOT mutate the passed-in state. Caller is responsible for writing
 * state.freeProxy.selected / deadHosts / poolFetchedAt based on the return value.
 *
 * Returns { pick, attemptedHosts, poolSize, error }.
 *   pick: { host, port, scheme, country, latencyMs, validatedAt } | null
 */
export async function pickAndValidate(state) {
  const deadHosts = (state.freeProxy && state.freeProxy.deadHosts) || {};
  let pool;
  try {
    pool = await fetchPool();
  } catch (err) {
    return { pick: null, attemptedHosts: [], poolSize: 0, error: `pool fetch failed: ${err.message}` };
  }
  const candidates = filterPool(pool, { deadHosts }).slice(0, MAX_VALIDATE_ATTEMPTS);
  if (candidates.length === 0) {
    return { pick: null, attemptedHosts: [], poolSize: pool.length, error: 'pool is empty after filtering' };
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
          country: result.country || cand.country || null,
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
    error: `no working proxies found (tried ${attempted.length})`,
  };
}
```

- [ ] Run: → 17 passes.

### Step 1.15: Commit Task 1

- [ ] Verify clean test run one more time:

```bash
node --test tests/free-pool.test.js
```

- [ ] Stage only the two new files (do NOT `git add -A`, repo has unrelated WIP):

```bash
git add extension/lib/free-pool.js tests/free-pool.test.js
git commit -m "feat(free-pool): add Proxifly pool fetch, filter, validate

Pure module: fetchPool (memory+storage+network cache, 5-min TTL),
filterPool (blocks RU/BY/CN/IR + deadHosts), validateProxy (Cloudflare
trace via temporary PAC swap), pickAndValidate (sequential up to 10).
Tests cover JSON array + NDJSON formats, cache tiers, country/protocol
filtering, validation success/failure, candidate iteration."
```

---

## Task 2: storage schema v2 migration

Adds `proxySource`, `manualProxy`, `freeProxy` to default state and migrates existing v1 state on load.

**Files:**
- Modify: `extension/lib/storage.js`
- Modify: `tests/storage.test.js` (already exists with 6 tests — two will need to update from schemaVersion 1 → 2; rest stay; append new migration tests)

### Step 2.1: Update existing storage tests for v2 + add migration tests

The existing `tests/storage.test.js` uses a module-level mock pattern (`let mockStore = {}` at the top, not per-test reset). Keep that pattern. Update the two assertions that hardcode `schemaVersion === 1` and append the new migration tests.

- [ ] In `tests/storage.test.js`, change line 19 from:

```js
test('getDefaultState: schemaVersion is 1', () => {
  assert.equal(getDefaultState().schemaVersion, 1);
});
```

to:

```js
test('getDefaultState: schemaVersion is 2', () => {
  assert.equal(getDefaultState().schemaVersion, 2);
});
```

- [ ] Change the `loadState: returns default state when storage empty` test (around line 37) from:

```js
test('loadState: returns default state when storage empty', async () => {
  await chrome.storage.local.clear();
  const s = await loadState();
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.enabled, false);
});
```

to:

```js
test('loadState: returns default state when storage empty', async () => {
  await chrome.storage.local.clear();
  const s = await loadState();
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.enabled, false);
});
```

- [ ] APPEND to the end of `tests/storage.test.js`:

```js
test('getDefaultState: includes new v2 fields', () => {
  const s = getDefaultState();
  assert.equal(s.proxySource, 'manual');
  assert.equal(s.manualProxy, null);
  assert.deepEqual(s.freeProxy, {
    selected: null,
    lastError: null,
    deadHosts: {},
    poolFetchedAt: 0,
  });
});

test('loadState: fresh storage returns default v2', async () => {
  await chrome.storage.local.clear();
  const s = await loadState();
  assert.equal(s.proxySource, 'manual');
});

test('loadState: migrates v1 with proxy → v2 with manualProxy', async () => {
  await chrome.storage.local.clear();
  mockStore.state = {
    schemaVersion: 1,
    enabled: true,
    proxy: { host: '1.2.3.4', port: 8080, scheme: 'http', user: 'u', pass: 'p' },
    theme: 'auto',
    resolvedTheme: 'light',
    presets: {},
    customDomains: [],
  };
  const s = await loadState();
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.proxySource, 'manual');
  assert.deepEqual(s.manualProxy, { host: '1.2.3.4', port: 8080, scheme: 'http', user: 'u', pass: 'p' });
  assert.deepEqual(s.proxy, { host: '1.2.3.4', port: 8080, scheme: 'http', user: 'u', pass: 'p' });
  assert.equal(s.freeProxy.selected, null);
  assert.deepEqual(s.freeProxy.deadHosts, {});
});

test('loadState: migrates v1 with null proxy → manualProxy null', async () => {
  await chrome.storage.local.clear();
  mockStore.state = {
    schemaVersion: 1,
    enabled: false,
    proxy: null,
    theme: 'auto',
    resolvedTheme: 'light',
    presets: {},
    customDomains: [],
  };
  const s = await loadState();
  assert.equal(s.proxySource, 'manual');
  assert.equal(s.manualProxy, null);
  assert.equal(s.proxy, null);
});

test('loadState: v2 state is loaded as-is (idempotent)', async () => {
  await chrome.storage.local.clear();
  mockStore.state = {
    schemaVersion: 2,
    enabled: true,
    proxy: { host: '5.5.5.5', port: 1080, scheme: 'socks5' },
    proxySource: 'free',
    manualProxy: { host: '1.1.1.1', port: 80, scheme: 'http' },
    freeProxy: {
      selected: { host: '5.5.5.5', port: 1080, scheme: 'socks5', country: 'NL', latencyMs: 100, validatedAt: 123 },
      lastError: null,
      deadHosts: { '9.9.9.9:80': Date.now() + 60_000 },
      poolFetchedAt: Date.now(),
    },
    theme: 'auto',
    resolvedTheme: 'light',
    presets: {},
    customDomains: [],
  };
  const s = await loadState();
  assert.equal(s.proxySource, 'free');
  assert.equal(s.manualProxy.host, '1.1.1.1');
  assert.equal(s.freeProxy.selected.host, '5.5.5.5');
});
```

### Step 2.2: Run, confirm failures

- [ ] Run:

```bash
node --test tests/storage.test.js
```

- [ ] Expected: failures on the new tests (`proxySource`/`manualProxy`/`freeProxy` undefined). The two updated assertions for `schemaVersion === 2` should now fail until step 2.3 lands.

### Step 2.3: Update `getDefaultState`

- [ ] Open `extension/lib/storage.js`. Replace the `getDefaultState` function:

```js
export function getDefaultState() {
  return {
    schemaVersion: 2,
    enabled: false,
    proxy: null,
    proxySource: 'manual',
    manualProxy: null,
    freeProxy: {
      selected: null,
      lastError: null,
      deadHosts: {},
      poolFetchedAt: 0,
    },
    theme: 'auto',
    resolvedTheme: 'light',
    presets: {
      gemini:     { enabled: true,  domains: ['gemini.google.com'] },
      aiStudio:   { enabled: true,  domains: ['aistudio.google.com', 'alkalimakersuite-pa.clients6.google.com'] },
      googleAuth: { enabled: true,  domains: ['accounts.google.com', 'ogs.google.com'] },
      notebookLM: { enabled: false, domains: ['notebooklm.google.com'] },
      googleLabs: { enabled: false, domains: ['labs.google', 'labs.google.com'] },
      chatgpt:    { enabled: false, domains: ['chatgpt.com', 'chat.openai.com'] },
      claude:     { enabled: false, domains: ['claude.ai'] },
      perplexity: { enabled: false, domains: ['perplexity.ai', 'www.perplexity.ai'] },
      grok:       { enabled: false, domains: ['grok.com', 'www.grok.com', 'x.ai'] },
      elevenlabs: { enabled: false, domains: ['elevenlabs.io', 'www.elevenlabs.io', 'api.elevenlabs.io'] },
      youtube:    { enabled: false, domains: ['youtube.com', 'www.youtube.com', 'youtu.be', 'googlevideo.com'] },
    },
    customDomains: [],
  };
}
```

### Step 2.4: Update `loadState` with migration

- [ ] In the same file, replace `loadState`:

```js
export async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const saved = result[STORAGE_KEY];
  if (!saved) return getDefaultState();

  const defaults = getDefaultState();

  // v1 → v2 migration
  if (!saved.schemaVersion || saved.schemaVersion < 2) {
    saved.schemaVersion = 2;
    saved.proxySource = 'manual';
    saved.manualProxy = saved.proxy ? { ...saved.proxy } : null;
    saved.freeProxy = { ...defaults.freeProxy };
  }

  // Backfill any preset that didn't exist when the user first installed.
  for (const [key, def] of Object.entries(defaults.presets)) {
    if (!saved.presets[key]) {
      saved.presets[key] = def;
    }
  }
  // Backfill theme fields for users upgrading from pre-0.4.3.
  if (!saved.theme) saved.theme = defaults.theme;
  if (!saved.resolvedTheme) saved.resolvedTheme = defaults.resolvedTheme;
  // Defensive: ensure freeProxy and its fields exist (e.g., partial v2 state)
  if (!saved.freeProxy) saved.freeProxy = { ...defaults.freeProxy };
  if (!saved.freeProxy.deadHosts) saved.freeProxy.deadHosts = {};

  return saved;
}
```

### Step 2.5: Run tests, confirm passes

- [ ] Run:

```bash
node --test tests/storage.test.js
```

- [ ] Expected: all storage tests pass (originally 6, now 11 after adding 5 new). Also run the full suite to make sure nothing regressed:

```bash
node --test
```

- [ ] Expected: existing `tests/domain.test.js` + `tests/pac.test.js` still all green; storage now 11; free-pool 17; total grew by ~22.

### Step 2.6: Commit Task 2

```bash
git add extension/lib/storage.js tests/storage.test.js
git commit -m "feat(storage): schema v2 — proxySource, manualProxy, freeProxy

Migrates v1 state on load: copies existing proxy → manualProxy,
sets proxySource='manual', initializes freeProxy. Idempotent;
v2 state passes through unchanged. Updates two existing test
assertions that pinned schemaVersion to 1; appends 5 new tests
covering the migration paths."
```

---

## Task 3: background message handlers + onErrorOccurred listener

Wires `lib/free-pool.js` into the service worker via three new message types and an auto-rotation listener.

**Files:**
- Modify: `extension/background.js`

### Step 3.1: Add `lib/free-pool.js` import

- [ ] At the top of `extension/background.js`, add the new import next to the existing ones:

```js
import { pickAndValidate } from './lib/free-pool.js';
```

(Place it after the existing `lib/` imports — keep file order consistent.)

### Step 3.2: Add `rotateFreeProxy` helper

- [ ] Add this function near `runProxyTest` (after `runProxyTest` definition, before `buildAllThroughPac` if it's still there — note: `buildAllThroughPac` in background.js was duplicated by lib/free-pool.js; we leave the background one alone because `runProxyTest` still uses it):

```js
/**
 * Mark the current free proxy as dead, find a new one, and update state.
 * Returns the new state (or unchanged if no new proxy found and no current to remove).
 */
async function rotateFreeProxy(state, { markCurrentDead = true } = {}) {
  if (state.proxySource !== 'free') return state;

  if (markCurrentDead && state.proxy?.host) {
    const key = `${state.proxy.host}:${state.proxy.port}`;
    state.freeProxy.deadHosts[key] = Date.now() + (30 * 60 * 1000); // 30-min TTL
  }

  const result = await pickAndValidate(state);
  if (result.pick) {
    state.freeProxy.selected = result.pick;
    state.freeProxy.lastError = null;
    state.proxy = {
      host: result.pick.host,
      port: result.pick.port,
      scheme: result.pick.scheme,
      user: '',
      pass: '',
      lastTest: {
        ok: true,
        country: result.pick.country,
        latencyMs: result.pick.latencyMs,
        at: Math.floor(Date.now() / 1000),
      },
    };
  } else {
    state.freeProxy.selected = null;
    state.freeProxy.lastError = result.error;
    state.proxy = null;
  }
  state.freeProxy.poolFetchedAt = Date.now();
  await saveState(state);
  return state;
}
```

### Step 3.3: Add the three new message handlers

- [ ] Find the existing `chrome.runtime.onMessage.addListener` block in `background.js`. Add three new handlers inside the listener function, BEFORE the final closing brace of the handler function. Insert in this order:

```js
  if (msg?.type === 'SWITCH_SOURCE') {
    (async () => {
      const state = await loadState();
      state.proxySource = msg.source === 'free' ? 'free' : 'manual';
      if (state.proxySource === 'manual') {
        state.proxy = state.manualProxy ? { ...state.manualProxy } : null;
        await saveState(state);
        sendResponse({ ok: true, state });
        return;
      }
      // → 'free'
      if (state.freeProxy.selected) {
        // Reuse previously-validated pick (may be stale; onErrorOccurred will rotate if dead).
        state.proxy = {
          host: state.freeProxy.selected.host,
          port: state.freeProxy.selected.port,
          scheme: state.freeProxy.selected.scheme,
          user: '',
          pass: '',
          lastTest: {
            ok: true,
            country: state.freeProxy.selected.country,
            latencyMs: state.freeProxy.selected.latencyMs,
            at: Math.floor(state.freeProxy.selected.validatedAt / 1000),
          },
        };
        await saveState(state);
        sendResponse({ ok: true, state });
        return;
      }
      // No prior pick → run pickAndValidate
      const newState = await rotateFreeProxy(state, { markCurrentDead: false });
      sendResponse({ ok: !!newState.freeProxy.selected, state: newState });
    })();
    return true;
  }

  if (msg?.type === 'ROTATE_FREE') {
    (async () => {
      const state = await loadState();
      const newState = await rotateFreeProxy(state, { markCurrentDead: true });
      sendResponse({ ok: !!newState.freeProxy.selected, state: newState });
    })();
    return true;
  }

  if (msg?.type === 'PERSIST_MANUAL') {
    (async () => {
      const state = await loadState();
      state.manualProxy = {
        host: msg.host || '',
        port: Number(msg.port) || 0,
        scheme: msg.scheme || 'auto',
        user: msg.user || '',
        pass: msg.pass || '',
      };
      if (state.proxySource === 'manual') {
        state.proxy = { ...state.manualProxy };
      }
      await saveState(state);
      sendResponse({ ok: true });
    })();
    return true;
  }
```

### Step 3.4: Add `onErrorOccurred` listener (top-level)

- [ ] At the top level of `background.js`, near `registerAuthListener()` call (line 12 area), add a new top-level statement:

```js
// 1b. Auto-rotate free proxy on proxy connection errors.
registerProxyErrorListener();
```

- [ ] Add the function definition near the bottom of the file, after the `detectScheme` function:

```js
function registerProxyErrorListener() {
  chrome.webRequest.onErrorOccurred.addListener(
    (details) => { handleProxyError(details).catch(() => {}); },
    { urls: ['<all_urls>'] }
  );
}

const PROXY_ERROR_CODES = new Set([
  'net::ERR_PROXY_CONNECTION_FAILED',
  'net::ERR_TUNNEL_CONNECTION_FAILED',
  'net::ERR_PROXY_AUTH_UNSUPPORTED',
  'net::ERR_MANDATORY_PROXY_CONFIGURATION_FAILED',
  'net::ERR_SOCKS_CONNECTION_FAILED',
  'net::ERR_SOCKS_CONNECTION_HOST_UNREACHABLE',
  'net::ERR_PROXY_CERTIFICATE_INVALID',
]);

const ROTATE_DEBOUNCE_MS = 10_000;

async function handleProxyError(details) {
  if (!PROXY_ERROR_CODES.has(details.error)) return;

  const now = Date.now();
  const last = globalThis.__lastRotateAt || 0;
  if (now - last < ROTATE_DEBOUNCE_MS) return;
  globalThis.__lastRotateAt = now;

  const state = await loadState();
  if (state.proxySource !== 'free') return;
  await rotateFreeProxy(state, { markCurrentDead: true });
}
```

### Step 3.5: Sanity-check by running existing tests

- [ ] Run the full suite to make sure imports resolve and nothing breaks:

```bash
node --test
```

- [ ] Expected: all existing tests pass. (No new tests in this task — wiring is integration-level.)

### Step 3.6: Manual smoke test via devtools

- [ ] Open `chrome://extensions`, load unpacked, open the service worker devtools (or background page).
- [ ] In the console, run:

```js
chrome.runtime.sendMessage({ type: 'SWITCH_SOURCE', source: 'free' }, console.log);
```

- [ ] Expected: within ~15s, response logs `{ ok: true, state: {...} }` with `state.freeProxy.selected` populated, or `{ ok: false, state }` with `state.freeProxy.lastError` set. During the call, Chrome is briefly routed through candidates — your other browser tabs may pause for a few seconds.
- [ ] Then run:

```js
chrome.runtime.sendMessage({ type: 'SWITCH_SOURCE', source: 'manual' }, console.log);
```

- [ ] Expected: response with `state.proxySource === 'manual'`, `state.proxy === state.manualProxy`.

### Step 3.7: Commit Task 3

```bash
git add extension/background.js
git commit -m "feat(bg): SWITCH_SOURCE, ROTATE_FREE, PERSIST_MANUAL handlers

Adds rotateFreeProxy helper and the three message handlers wiring
lib/free-pool into the service worker. Adds onErrorOccurred listener
that auto-rotates on net::ERR_PROXY_*/TUNNEL_*/SOCKS_* with a 10s
debounce. Existing TEST_PROXY/TEST_GEMINI/DETECT_SCHEME handlers
untouched — they operate on state.proxy regardless of source."
```

---

## Task 4: popup UI — source toggle, free-block, AI banner, manifest bump

**Files:**
- Modify: `extension/popup/popup.html`
- Modify: `extension/popup/popup.css`
- Modify: `extension/popup/popup.js`
- Modify: `extension/manifest.json`

### Step 4.1: Add HTML — source pills + free-block

- [ ] In `extension/popup/popup.html`, inside `<section id="screen-settings">`, INSERT a new block BEFORE the existing `<!-- Protocol -->` block (the one with `id="scheme-pills"`):

```html
      <section class="block">
        <div class="block-label">Proxy source</div>
        <div class="pill-group" id="source-pills">
          <button type="button" data-source="manual" class="pill">Manual</button>
          <button type="button" data-source="free"   class="pill">Free pool</button>
        </div>
      </section>

      <section class="block free-block" id="free-block" hidden>
        <div class="block-label">Free proxy pool</div>
        <div class="free-current" id="free-current">No proxy selected</div>
        <div class="free-pool-meta" id="free-pool-meta"></div>
        <button type="button" class="action" id="rotate-free">↻ Rotate now</button>
        <div class="free-warning">
          ⚠ Free proxies are public and untrusted. Avoid logging into accounts
          you care about while routed through them.
        </div>
      </section>
```

- [ ] Wrap the existing Protocol block, Host+Port row, and Authentication block in a single container so they can be toggled together. Find the existing `<section class="block">` containing `id="scheme-pills"` and wrap it (along with the next two `<section class="block">` siblings up to and including the Authentication one) in:

```html
      <div id="manual-blocks">
        <!-- Protocol section here -->
        <!-- Host+Port section here -->
        <!-- Authentication section here -->
      </div>
```

(Test buttons section stays outside `manual-blocks` — it works in both modes.)

### Step 4.2: Add HTML — AI-banner in main screen

- [ ] In `<section id="screen-main">`, INSERT directly AFTER the existing `<div class="rkn-banner" id="rkn-banner" hidden>` block:

```html
      <div class="ai-free-banner" id="ai-free-banner" hidden>
        <span class="ai-free-icon">⚠</span>
        <span class="ai-free-text">
          Free proxy active with AI services — Google may flag this account.
          Use a private proxy for Google account access.
        </span>
      </div>
```

### Step 4.3: Add CSS

- [ ] Append to `extension/popup/popup.css`:

```css
/* Free proxy pool — settings screen */
.free-block .free-current {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  padding: 8px 10px;
  background: var(--surface-2, #f6f7f9);
  border-radius: 6px;
  margin-bottom: 6px;
}
.free-block .free-pool-meta {
  font-size: 11px;
  color: var(--text-muted, #6b7280);
  margin-bottom: 10px;
}
.free-block .free-warning {
  font-size: 11px;
  color: var(--text-muted, #6b7280);
  margin-top: 10px;
  padding: 8px 10px;
  background: rgba(245, 158, 11, 0.08);
  border-left: 3px solid #f59e0b;
  border-radius: 4px;
}
.free-block #rotate-free {
  width: 100%;
}

/* AI banner — main screen */
.ai-free-banner {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 12px;
  margin: 8px 0;
  background: rgba(245, 158, 11, 0.12);
  border-left: 3px solid #f59e0b;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
}
.ai-free-banner .ai-free-icon {
  flex: 0 0 auto;
  font-size: 14px;
}
```

### Step 4.4: Add `AI_PRESET_KEYS` import to popup.js

- [ ] At the top of `extension/popup/popup.js`, change:

```js
import { PRESET_DEFINITIONS, PRESET_ORDER } from '../lib/presets.js';
```

to:

```js
import { PRESET_DEFINITIONS, PRESET_ORDER, AI_PRESET_KEYS } from '../lib/presets.js';
```

### Step 4.5: Add source toggle binding in `bindSettings`

- [ ] In `extension/popup/popup.js`, find the `bindSettings` function. Add at the end of that function, just BEFORE the test-button bindings:

```js
  // Source toggle (Manual / Free pool)
  for (const pill of document.querySelectorAll('#source-pills .pill')) {
    pill.addEventListener('click', async () => {
      const source = pill.dataset.source;
      if (state.proxySource === source) return;

      // Disable both pills while switching
      for (const p of document.querySelectorAll('#source-pills .pill')) p.disabled = true;
      $('#rotate-free').disabled = true;
      $('#free-current').textContent = source === 'free' ? 'Searching for working proxy…' : 'Switching…';

      try {
        const res = await chrome.runtime.sendMessage({ type: 'SWITCH_SOURCE', source });
        state = res.state;
        renderSettings();
      } finally {
        for (const p of document.querySelectorAll('#source-pills .pill')) p.disabled = false;
        $('#rotate-free').disabled = false;
      }
    });
  }

  $('#rotate-free').addEventListener('click', async () => {
    const btn = $('#rotate-free');
    btn.disabled = true;
    $('#free-current').textContent = 'Searching for working proxy…';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ROTATE_FREE' });
      state = res.state;
      renderSettings();
    } finally {
      btn.disabled = false;
    }
  });
```

### Step 4.6: Mirror state.proxy → state.manualProxy when source=manual

When source=manual, every mutation of `state.proxy` (via field blur, scheme pill click, auto-parse) must also be reflected in `state.manualProxy` so that switching to Free and back doesn't wipe the user's config. Single local helper, no background round-trip — local writes go through `persist()` already and the existing `chrome.storage.onChanged` listener handles re-render.

(Note: the `PERSIST_MANUAL` message handler from Task 3 is not invoked during normal typing. It remains available as part of the message contract for explicit programmatic use, but is unused in this UI flow.)

- [ ] Add the helper at the bottom of `extension/popup/popup.js`, just BEFORE the final `init()` call:

```js
function mirrorManual() {
  if (state.proxySource !== 'manual') return;
  if (!state.proxy) return;
  state.manualProxy = { ...state.proxy };
  delete state.manualProxy.lastTest; // lastTest belongs on active proxy only
}
```

- [ ] In `bindSettings`, find the scheme pills handler block. Inside the click handler, after `state.proxy.scheme = scheme;` (and after `state.proxy.scheme = 'auto';` for the auto branch), add `mirrorManual();` BEFORE the `await persist();` call. Same change for both branches (auto and explicit scheme).

- [ ] In the hostEl blur handler in `bindSettings`, in the `if (parsed)` branch, after the existing field assignments and before `await persist();`, add `mirrorManual();`. In the `else` branch (where `state.proxy.host = raw`), add `mirrorManual();` before `await persist();`.

- [ ] In the `otherFields` loop in `bindSettings`, update each handler:

Replace:
```js
    el.addEventListener('blur', async () => {
      ensureProxyObject();
      state.proxy[key] = parse(el.value);
      await persist();
    });
```

With:
```js
    el.addEventListener('blur', async () => {
      ensureProxyObject();
      state.proxy[key] = parse(el.value);
      mirrorManual();
      await persist();
    });
```

### Step 4.7: Update `renderSettings` to handle both modes

- [ ] Replace the entire `renderSettings` function:

```js
function renderSettings() {
  ensureProxyObject();

  // Source pills
  for (const pill of document.querySelectorAll('#source-pills .pill')) {
    pill.classList.toggle('active', pill.dataset.source === (state.proxySource || 'manual'));
  }

  const isFree = state.proxySource === 'free';
  $('#manual-blocks').hidden = isFree;
  $('#free-block').hidden = !isFree;

  // Manual fields
  $('#cfg-host').value = state.proxy?.host || '';
  $('#cfg-port').value = state.proxy?.port || '';
  $('#cfg-user').value = state.proxy?.user || '';
  $('#cfg-pass').value = state.proxy?.pass || '';
  for (const pill of document.querySelectorAll('#scheme-pills .pill')) {
    pill.classList.toggle('active', pill.dataset.scheme === state.proxy?.scheme);
  }

  // Free-block render
  if (isFree) {
    const sel = state.freeProxy?.selected;
    if (sel) {
      const flag = sel.country ? `${countryFlag(sel.country)} ${sel.country}` : '—';
      $('#free-current').textContent = `${sel.host}:${sel.port}  ${flag}  ${sel.latencyMs}ms`;
    } else if (state.freeProxy?.lastError) {
      $('#free-current').textContent = `No working proxy: ${state.freeProxy.lastError}`;
    } else {
      $('#free-current').textContent = 'No proxy selected';
    }
    const fetchedAt = state.freeProxy?.poolFetchedAt;
    if (fetchedAt) {
      const ageMin = Math.floor((Date.now() - fetchedAt) / 60_000);
      $('#free-pool-meta').textContent = `Pool refreshed ${ageMin}m ago`;
    } else {
      $('#free-pool-meta').textContent = '';
    }
  }

  renderThemePills();
  $('#test-result').hidden = true;
}

function countryFlag(cc) {
  if (!cc || cc.length !== 2) return '';
  const A = 0x41, base = 0x1F1E6;
  return String.fromCodePoint(base + cc.charCodeAt(0) - A, base + cc.charCodeAt(1) - A);
}
```

### Step 4.8: Update `renderMain` — show AI banner

- [ ] At the end of `renderMain`, before the closing brace, add:

```js
  // AI-free banner
  const aiBanner = $('#ai-free-banner');
  if (aiBanner) {
    const aiOn = AI_PRESET_KEYS.some((k) => state.presets[k]?.enabled);
    aiBanner.hidden = !(aiOn && state.proxySource === 'free' && state.enabled);
  }
```

### Step 4.9: Update `routeInitialScreen` for free mode

- [ ] The current `routeInitialScreen` checks `state.proxy?.host` to decide first-run vs main. In free mode the user has no host to enter — they just need to flip to Free pool. Update:

Replace:
```js
function routeInitialScreen() {
  const screens = ['main', 'settings', 'firstrun'];
  for (const s of screens) $(`#screen-${s}`).hidden = true;

  if (!state.proxy || !state.proxy.host) {
    $('#screen-firstrun').hidden = false;
  } else {
    showMain();
  }
}
```

With:
```js
function routeInitialScreen() {
  const screens = ['main', 'settings', 'firstrun'];
  for (const s of screens) $(`#screen-${s}`).hidden = true;

  const hasManual = state.proxySource === 'manual' && state.proxy?.host;
  const hasFree = state.proxySource === 'free' && state.freeProxy?.selected;
  if (!hasManual && !hasFree) {
    $('#screen-firstrun').hidden = false;
  } else {
    showMain();
  }
}
```

### Step 4.10: Bump manifest version

- [ ] Open `extension/manifest.json`. Change `"version": "0.4.3"` to `"version": "0.5.0"`. Update `description`:

```json
"description": "Per-domain proxy router for Chromium. Routes a configurable list of domains through your own HTTP/SOCKS proxy or a curated free proxy pool.",
```

### Step 4.11: Manual smoke testing

Run through every item. If anything fails, fix and re-test before committing.

- [ ] Reload the unpacked extension at `chrome://extensions`.
- [ ] Open the popup. Default: shows main screen or first-run depending on whether you had a proxy configured.
- [ ] Click the gear → Settings. Verify "Source" pill group is at the top, "Manual" active by default.
- [ ] Verify existing Protocol/Host/Port/Auth fields are visible, behave exactly as before.
- [ ] Click "Free pool" pill. Verify Manual fields hide, Free block shows, "Searching for working proxy…" appears.
- [ ] Within ~15s, verify it either shows `host:port  🇳🇱 NL  142ms` style OR `No working proxy: ...` with an error.
- [ ] Click "Rotate now". Verify it searches again and either finds another or shows error.
- [ ] Click "Manual". Verify Free block hides, Manual fields reappear with previously-entered config intact.
- [ ] Switch back to Free pool. Verify it reuses the previous selection without re-searching (assuming it had one).
- [ ] Go back to main screen. Enable any AI preset (Gemini/AI Studio/NotebookLM). Verify the AI banner appears.
- [ ] Disable all AI presets. Verify banner hides.
- [ ] Enable master toggle + an AI preset + Free pool active. Open `gemini.google.com`. Verify it loads through the free proxy.
- [ ] In settings, click "Test Gemini" while in Free mode. Verify it works.
- [ ] Switch theme. Verify Free block + banner colors are readable in dark mode.

### Step 4.12: Commit Task 4

```bash
git add extension/popup/popup.html extension/popup/popup.css extension/popup/popup.js extension/manifest.json
git commit -m "feat(popup): source toggle + free pool block + AI banner

Settings: new Manual/Free source pill group above existing fields,
free-block with current proxy + Rotate button + warning, manual fields
collapse when Free is active. Main: AI banner when free + any AI preset
enabled. Field changes go through PERSIST_MANUAL so the source-switch
roundtrip stays consistent. Bumps manifest to 0.5.0."
```

---

## Final verification

- [ ] Run the full test suite one more time:

```bash
cd c:/Users/Konstantin/projects/gemini-unblock && node --test
```

- [ ] Expected: all tests pass — existing `domain.test.js` + new `storage.test.js` (5) + new `free-pool.test.js` (17).

- [ ] Run `git log --oneline -5` to confirm 4 new commits on top of the spec commit (`50b4b92`):
  1. `feat(free-pool): add Proxifly pool fetch, filter, validate`
  2. `feat(storage): schema v2 — proxySource, manualProxy, freeProxy`
  3. `feat(bg): SWITCH_SOURCE, ROTATE_FREE, PERSIST_MANUAL handlers`
  4. `feat(popup): source toggle + free pool block + AI banner`

- [ ] Verify uncommitted state in the repo is unchanged from before this work (the pre-existing WIP on icons, popup, manifest, package.json was not touched — only the four files this plan modifies were committed, and they were each part of one focused commit). Run `git status --short` and confirm the only `M`/`??` lines remaining match what was there before Task 1.

Plan complete.
