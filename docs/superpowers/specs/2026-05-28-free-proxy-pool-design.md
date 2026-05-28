# Free Proxy Pool — Design

**Date:** 2026-05-28
**Status:** Draft pending user review
**Target version:** 0.5.0
**Depends on:** [2026-04-12-gemini-unblock-extension-design.md](2026-04-12-gemini-unblock-extension-design.md) (core extension)

---

## 1. Goal

Add a second proxy source to the extension: alongside the existing manually-configured proxy ("Manual"), users can switch to a "Free pool" mode that draws working proxies from the public [proxifly/free-proxy-list](https://github.com/proxifly/free-proxy-list) feed. The extension validates each candidate before activating it and auto-rotates when the active proxy stops responding. The manual configuration is preserved when switching modes so users can flip back and forth without re-entering credentials.

Primary use case: a user who does not own a proxy and wants the extension to "just work" for non-account-critical browsing (YouTube, news, geo-restricted sites). Free proxies are explicitly discouraged for Google account access; the UI surfaces this risk but does not block it.

## 2. Non-goals

- Hosting, mirroring, or maintaining our own proxy list — we are a client of Proxifly's public feed.
- Paid proxy provider integrations or affiliate routing.
- Per-domain proxy selection inside the free pool (one selected proxy serves all routed domains, same as Manual mode).
- Multi-proxy load balancing or split routing.
- User-facing filters for country, protocol, or anonymity level (auto-selection only; advanced controls deferred).
- Background warm pool maintenance — Chrome MV3 has no per-fetch proxy, so periodic background health checks would repeatedly interrupt active sessions. Out of scope.
- Persisting individual free-proxy credentials (free proxies are anonymous).

## 3. Architecture overview

One new module (`lib/free-pool.js`), additive changes to `lib/storage.js` and `background.js`, additive UI in `popup/`. The existing `lib/proxy.js`, `lib/pac.js`, and the `applyProxy` → PAC pipeline are **not modified** — `state.proxy` continues to be the single source of truth for what is wired into Chrome, and the free-pool module simply writes to it when a working proxy is found.

```
                          ┌─────────────────┐
   Proxifly raw JSON ────►│ free-pool.js    │
                          │  fetch + cache  │
                          │  filter + pick  │
                          │  validate       │
                          └────────┬────────┘
                                   │ writes state.proxy
                                   ▼
   popup ──message──► background.js ──► chrome.storage.local
                                              │ onChanged
                                              ▼
                                         applyProxy() ──► chrome.proxy
```

## 4. State schema changes

`lib/storage.js` extends `getDefaultState()` with three additive fields. Existing fields keep their semantics.

```js
{
  schemaVersion: 2,                     // bumped from 1
  enabled: false,
  proxy: null,                          // ACTIVE — wired into PAC. unchanged.
  proxySource: 'manual',                // NEW — 'manual' | 'free'
  manualProxy: null,                    // NEW — saved Manual config, restored on switch back
  freeProxy: {                          // NEW
    selected: null,                     //   { host, port, scheme, country, latencyMs, validatedAt }
    lastError: null,                    //   user-facing string when pickAndValidate returns null
    deadHosts: {},                      //   { 'host:port': expiresAt } TTL 30 min
    poolFetchedAt: 0,                   //   epoch ms of last successful fetch
  },
  theme: 'auto',
  resolvedTheme: 'light',
  presets: { … },
  customDomains: [],
  rknResults: { … },
  rknLastCheckAt: number,
}
```

**Invariant:** `state.proxy` reflects what is in PAC right now. When `proxySource === 'free'`, `state.proxy` is a copy of `freeProxy.selected` (or `null` if none picked yet). When `proxySource === 'manual'`, `state.proxy` is a copy of `manualProxy`.

**Migration (schemaVersion 1 → 2):** in `loadState()`, if `proxySource` is missing:
1. `proxySource = 'manual'`
2. `manualProxy = { ...state.proxy }` if `state.proxy` exists, else `null`
3. `freeProxy = { selected: null, lastError: null, deadHosts: {}, poolFetchedAt: 0 }`
4. `schemaVersion = 2`
5. Save back.

Migration runs once at load, idempotent.

## 5. The `lib/free-pool.js` module

Pure data + one network side-effect. Follows the `lib/rkn-check.js` pattern (memory cache → chrome.storage cache → network fetch).

### 5.1 Constants

```js
const POOL_URL = 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.json';
const POOL_TTL_MS = 5 * 60 * 1000;            // matches Proxifly refresh cadence
const POOL_CACHE_KEY = 'freeProxyPoolCache';
const FETCH_TIMEOUT_MS = 15_000;
const VALIDATE_TIMEOUT_MS = 3_000;            // per candidate
const VALIDATE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';
const MAX_VALIDATE_ATTEMPTS = 10;
const BLOCKED_COUNTRIES = new Set(['RU', 'BY', 'CN', 'IR']);
const DEAD_HOST_TTL_MS = 30 * 60 * 1000;
```

`BLOCKED_COUNTRIES` rationale: these jurisdictions either block Google services themselves or have proxies that get blocked instantly by Google — useless for the extension's primary domains.

### 5.2 Public API

```js
async function fetchPool({ force = false }): Promise<Array<{host, port, protocol, country}>>
function filterPool(pool, { deadHosts: Object }): Array<Candidate>
async function pickAndValidate(state): Promise<Pick | null>
async function validateProxy(candidate): Promise<{ok, latencyMs, country, error}>
```

**`fetchPool`** — three-tier cache identical to `rkn-check.loadRknList()`. Returns parsed and normalized array `[{host, port, protocol: 'http'|'socks4'|'socks5', country}, …]`. Entries with missing fields or invalid ports are dropped during normalization.

Proxifly entries have shape `{ proxy: 'socks5://1.2.3.4:1080', protocol, ip, port, https, anonymity, score, geolocation: { country, city, … } }`. The wire format of `/proxies/all/data.json` is verified at implementation time — the parser must handle either a JSON array (`[{…}, {…}]`) or NDJSON (one object per line) by trying `JSON.parse` first and falling back to line-by-line. We use `protocol`, `ip` (→ `host`), `port`, `geolocation.country` (→ `country`).

**`filterPool`** — drops entries whose country is in `BLOCKED_COUNTRIES` or whose `host:port` is in `deadHosts` (with expired entries pruned). Returns a shuffled array (`Math.random()`-based Fisher-Yates).

**`pickAndValidate`** — fetches pool, filters by `state.freeProxy.deadHosts`, takes the first `MAX_VALIDATE_ATTEMPTS` candidates, validates each sequentially via `validateProxy`. Returns `{ pick: {host, port, scheme, country, latencyMs, validatedAt} | null, attemptedHosts: Array<'host:port'>, poolSize: number, error: string | null }`. The module does NOT mutate the passed-in state — the background handler reads the returned object and mutates `state.freeProxy.selected`, `state.freeProxy.poolFetchedAt`, etc. itself. Keeps free-pool.js side-effect-free except for the network fetch and the temporary `chrome.proxy.settings.set` during validation.

**`validateProxy`** — temporarily sets Chrome's PAC to route ALL traffic through the candidate, fetches `cloudflare.com/cdn-cgi/trace` with a 3 s timeout, parses `ip=` and `loc=` from the plain-text response, then restores the previous PAC via `applyProxy(state)`. This reuses the exact pattern already proven in `background.js: runProxyTest` / `detectScheme`. Returns `{ok: true, latencyMs, country: 'NL', error: null}` on success or `{ok: false, error: '…'}` on failure.

Note: `validateProxy` briefly interrupts the user's current routing (a few seconds total). This is acceptable because validation only runs on explicit user action (switch to Free, Rotate) or after a proxy error (the routing is already broken).

### 5.3 Sequential vs parallel validation

Sequential. Parallel race would require N global `chrome.proxy.settings.set` swaps which is incoherent in MV3 (one global setting). Sequential gives us deterministic behavior at the cost of latency. Typical case (~10-20% of free proxies alive) means 5-10 attempts to find a working one, ~5-15 s total — acceptable for a one-shot operation.

## 6. Background logic (`background.js`)

### 6.1 New message handlers

Added to the existing `chrome.runtime.onMessage` switch:

```
SWITCH_SOURCE { source: 'manual' | 'free' }
  → loadState
  → state.proxySource = source
  → source==='manual': state.proxy = state.manualProxy
  → source==='free':   if state.freeProxy.selected exists, state.proxy = selected
                       else pickAndValidate → set state.proxy and freeProxy.selected
                       on null: state.proxy = null, freeProxy.lastError = '...'
  → saveState (storage.onChanged triggers applyProxy automatically)
  → sendResponse with new state

ROTATE_FREE {}
  → loadState
  → if state.proxy, mark current host:port as dead with TTL
  → pickAndValidate excluding dead set
  → update state.proxy + freeProxy.selected (or lastError on failure)
  → saveState
  → sendResponse with new state

PERSIST_MANUAL { host, port, scheme, user, pass }
  → loadState
  → state.manualProxy = { host, port: Number(port), scheme, user: user||'', pass: pass||'' }
  → if state.proxySource === 'manual', state.proxy = state.manualProxy
  → saveState
  → sendResponse { ok: true }
```

Existing handlers (`TEST_PROXY`, `TEST_GEMINI`, `DETECT_SCHEME`, `CHECK_DOMAIN`, `RKN_CHECK`) are not changed — they all operate on `state.proxy` and remain agnostic to the source.

### 6.2 Auto-rotation on proxy errors

New top-level listener registered in `background.js` alongside `registerAuthListener()`:

```js
chrome.webRequest.onErrorOccurred.addListener(
  (details) => { handleProxyError(details); },
  { urls: ['<all_urls>'] }
);
```

`handleProxyError`:
1. If `isProxyError(details.error)` is false — return (cheap check, before touching storage).
2. 10-second in-memory debounce: read `globalThis.__lastRotateAt`; if `now - lastRotateAt < 10_000` — return. Otherwise set `globalThis.__lastRotateAt = now` immediately. The timestamp is best-effort (service worker may sleep and reset it); worst case we rotate slightly more often than 10s. Not load-bearing for correctness.
3. Load state. If `proxySource !== 'free'` — return. If `state.proxy?.host` doesn't match the error's likely proxy (no clean way to check via the `details` object, so we trust the `proxySource` gate) — proceed anyway.
4. Call the same internal function that `ROTATE_FREE` message handler uses (extracted as `rotateFreeProxy(state)`). Service workers can't reliably `chrome.runtime.sendMessage` to themselves, so direct call is required.

`isProxyError` matches:
```
net::ERR_PROXY_CONNECTION_FAILED
net::ERR_TUNNEL_CONNECTION_FAILED
net::ERR_PROXY_AUTH_UNSUPPORTED
net::ERR_MANDATORY_PROXY_CONFIGURATION_FAILED
net::ERR_SOCKS_CONNECTION_FAILED
net::ERR_SOCKS_CONNECTION_HOST_UNREACHABLE
net::ERR_PROXY_CERTIFICATE_INVALID
```

`net::ERR_TIMED_OUT` and other generic errors are NOT matched — too noisy, too many false positives.

## 7. Popup UI

### 7.1 Settings screen — source toggle

A new pill-group block is inserted **before** the existing Protocol block:

```html
<section class="block">
  <div class="block-label">Proxy source</div>
  <div class="pill-group" id="source-pills">
    <button type="button" data-source="manual" class="pill">Manual</button>
    <button type="button" data-source="free"   class="pill">Free pool</button>
  </div>
</section>
```

When `proxySource === 'manual'`: existing blocks (Protocol pills, Host+Port row, Authentication, Test buttons) are visible. Behavior unchanged. Field changes call `PERSIST_MANUAL` on blur instead of writing `state.proxy` directly.

When `proxySource === 'free'`: those blocks are hidden via `hidden` attribute. A new Free-pool block is shown:

```html
<section class="block free-block" id="free-block" hidden>
  <div class="block-label">Free proxy pool</div>
  <div class="free-current" id="free-current">
    <!-- Filled by popup.js:
         - "Searching for working proxy…" (during pickAndValidate)
         - "185.x.x.x:1080  🇳🇱 NL  142ms" + small "validated 2m ago"
         - "No working proxy found" + lastError
    -->
  </div>
  <div class="free-pool-meta" id="free-pool-meta">
    Pool: 12 845 proxies • refreshed 3m ago
  </div>
  <button type="button" class="action" id="rotate-free">↻ Rotate now</button>
  <div class="free-warning">
    ⚠ Free proxies are public and untrusted. Avoid logging into accounts
    you care about while routed through them.
  </div>
</section>
```

The `Test proxy` / `Test Gemini` buttons remain visible in both modes — they work on `state.proxy` regardless of source.

### 7.2 Source toggle interaction

Clicking a source pill sends `SWITCH_SOURCE` to background and updates the local pill state optimistically. When background's response comes back (with potentially picked proxy), popup re-renders the Free block based on `state.freeProxy.selected`. While `pickAndValidate` is running, the Rotate button shows `Searching…` and is disabled.

### 7.3 Main screen — AI-banner

A new banner added below the existing `rkn-banner`, sharing its CSS:

```html
<div class="ai-free-banner" id="ai-free-banner" hidden>
  <span class="ai-free-icon">⚠</span>
  <span class="ai-free-text">
    Free proxy active with AI services — Google may flag this account.
    Use a private proxy for Google account access.
  </span>
</div>
```

Visibility logic in `popup.js`:
```js
const aiEnabled = AI_PRESET_KEYS.some((k) => state.presets[k]?.enabled);
const onFree = state.proxySource === 'free';
banner.hidden = !(aiEnabled && onFree && state.enabled);
```

`AI_PRESET_KEYS` is already exported from `lib/presets.js`.

### 7.4 CSS

`.free-block` reuses existing `.block` styles. New rules in `popup.css`:
- `.free-current` — monospace IP, country flag emoji + code, latency in muted color
- `.free-pool-meta` — small muted text
- `.free-warning` — same yellow-ish look as `.rkn-banner` but inline (not full-width)
- `.ai-free-banner` — same shape as `.rkn-banner`, slightly different color (amber vs blue) to signal a different kind of warning

## 8. Manifest changes

- `version`: `0.4.3` → `0.5.0` (new feature, schema migration)
- `description`: updated to mention "or a curated free proxy pool"
- `permissions`: no changes — `proxy`, `storage`, `webRequest`, `tabs`, `alarms`, `unlimitedStorage` already cover everything needed
- `host_permissions`: no changes — `<all_urls>` already there

## 9. Testing

### 9.1 Unit tests (node + mocked chrome)

Existing pattern: `tests/domain.test.js` mocks `globalThis.chrome`. Same approach for new tests.

**`tests/free-pool.test.js`** (new):
- `fetchPool` parses sample Proxifly JSON correctly (8 valid + 2 malformed → 8 entries returned)
- `fetchPool` memory cache: second call within TTL doesn't hit fetch
- `fetchPool` storage cache: cold start with fresh storage entry uses it
- `fetchPool` network error → throws, caller's responsibility
- `filterPool` drops `BLOCKED_COUNTRIES` entries
- `filterPool` drops `deadHosts` entries (and prunes expired ones from the object)
- `filterPool` drops entries missing host or port
- `filterPool` returns shuffled — verified by checking output ≠ input for a large enough pool (allowed to flake at 1/N!)
- `pickAndValidate` with 1st candidate alive → returns it; `chrome.proxy.settings.set` called twice (set+restore)
- `pickAndValidate` with 1st-3rd dead, 4th alive → returns 4th
- `pickAndValidate` with all dead → returns null
- `validateProxy` parses CF trace response correctly (`ip=`, `loc=`)
- `validateProxy` timeout → returns `{ok: false, error}`

**`tests/storage.test.js`** (new):
- Migration: schemaVersion 1 state with `proxy: {host, port, scheme}` and no `proxySource` → after `loadState`, `proxySource === 'manual'`, `manualProxy` matches old `proxy`, `schemaVersion === 2`
- Migration idempotent: loading a v2 state doesn't re-migrate
- Migration with `proxy: null` → `manualProxy: null`

### 9.2 Manual smoke tests

Documented in plan, not automated:
- Load unpacked, default state shows Manual mode (regression)
- Switch to Free pool → spinner → some proxy appears within ~15s OR clear "no working proxy" message
- Test Gemini button works in Free mode
- Enable an AI preset → AI banner appears on main screen
- Disable all AI presets → AI banner hides
- Switch back to Manual → previously-entered manual config reappears (not wiped)
- Kill network mid-validation → graceful failure with lastError message
- Trigger ERR_PROXY_CONNECTION_FAILED (use a known-dead proxy) → auto-rotate fires within 10s

## 10. Decomposition (for the implementation plan)

The plan will split into roughly four sequential PRs/commits:

1. **`lib/free-pool.js` + unit tests** — pure module, no integration. Can be merged independently and verified by tests only.
2. **storage migration + new state fields** — `getDefaultState`, `loadState` migration logic, schema bump. Tests cover migration.
3. **background message handlers + onErrorOccurred listener** — wires free-pool into the service worker. Manual test via `chrome.runtime.sendMessage` from devtools.
4. **popup UI** — source toggle, Free block, AI banner, CSS. Manual smoke testing.

manifest version bump happens in commit 4.

## 11. Risks and tradeoffs

- **Free proxies are dangerous for accounts.** Mitigated by the AI banner and the inline warning, but not blocked. A malicious proxy operator cannot break TLS to `gemini.google.com` (cert validation holds), but they can log all metadata: which sites you visit, when, request sizes. Google can also flag the account based on IP reputation.
- **Validation interrupts active routing.** A few seconds during switch/rotate. Documented in UI as "Searching…". Cannot be avoided in MV3.
- **Proxifly availability.** If the GitHub raw URL becomes unavailable or rate-limits, `fetchPool` fails and the Free block shows an error. Stale chrome.storage cache (up to 5 min old) is the fallback.
- **deadHosts growth.** Bounded to ~10 entries per session by `MAX_VALIDATE_ATTEMPTS` per pickAndValidate call. Pruned on every filterPool call. Realistic ceiling: a few dozen entries.
- **`chrome.webRequest.onErrorOccurred` is noisy.** Strict filter on specific `net::ERR_PROXY_*` / `ERR_SOCKS_*` / `ERR_TUNNEL_*` codes + 10s debounce keeps rotation calm.
- **Country filter is fixed.** Hardcoded `RU/BY/CN/IR` blacklist. If a user has a legitimate reason to use one of those (unlikely for the target audience), they need Manual mode. Acceptable for v1.
