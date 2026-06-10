// Service worker entry. Registers listeners at top level so they survive
// sleep/wake. On startup: load state, push PAC, set initial icon for the
// active tab.

import './lib/compat.js';
import { loadState, saveState } from './lib/storage.js';
import { applyProxy, registerProxyAuth, probeThroughProxy } from './lib/proxy-backend.js';
import { setIconState } from './lib/icon.js';
import { isHostRouted } from './lib/pac.js';
import { checkAllPresets, isCheckDue, checkDomain } from './lib/rkn-check.js';
import { pickAndValidate, fetchPool, nextLiveProxy, DEAD_HOST_TTL_MS } from './lib/free-pool.js';

// 1. Auth listener — must be top-level for sleep/wake survival.
registerProxyAuth(loadState);

// 1b. Auto-rotate free proxy on proxy connection errors.
registerProxyErrorListener();

// 2. Storage change → re-apply PAC and refresh icons.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.state) return;
  const state = changes.state.newValue;
  await applyProxy(state);
  await refreshActiveTabIcon(state);
});

// 3. Tab activation → refresh icon for newly-active tab.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const state = await loadState();
  await refreshTabIcon(tabId, state);
});

// 4. Tab navigation completed → refresh icon (URL may have changed).
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
  if (changeInfo.status !== 'complete') return;
  const state = await loadState();
  await refreshTabIcon(tabId, state);
});

// 5. Boot/wake + RKN compliance check.
(async function boot() {
  const state = await loadState();
  await applyProxy(state);
  await refreshActiveTabIcon(state);
  await maybeRunRknCheck(state);
})();

// 6. Periodic alarms. ensureAlarm() only creates an alarm if it doesn't already
// exist — re-creating with the same name RESETS the schedule, and the MV3 worker
// is evicted/restarted often, so an unconditional create on every wake could push
// a short-period alarm out forever and it would never fire.
const FREE_REFRESH_MINUTES = 5;
function ensureAlarm(name, periodInMinutes) {
  chrome.alarms.get(name, (existing) => {
    if (!existing) chrome.alarms.create(name, { periodInMinutes });
  });
}
ensureAlarm('rkn-check', 24 * 60);
ensureAlarm('free-pool-refresh', FREE_REFRESH_MINUTES);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'rkn-check') {
    const state = await loadState();
    await runRknCheck(state);
  } else if (alarm.name === 'free-pool-refresh') {
    await refreshFreeProxy().catch((err) => {
      console.warn('[bg] free-pool refresh failed:', err.message);
    });
  }
});

async function maybeRunRknCheck(state) {
  if (!isCheckDue(state.rknLastCheckAt)) return;
  await runRknCheck(state);
}

async function runRknCheck(state) {
  const results = await checkAllPresets(state.presets || {});
  if (!results) {
    // RKN list unavailable → no data to decide on. Keep last known rknResults and
    // preset enabled-state untouched rather than disabling everything on a
    // transient fetch failure.
    console.warn('[RKN] list unavailable — skipping check, state unchanged');
    return;
  }
  state.rknResults = results;
  state.rknLastCheckAt = Date.now();

  // Disable presets whose domains are RKN-blocked.
  let changed = false;
  for (const [_key, preset] of Object.entries(state.presets || {})) {
    const blocked = (preset.domains || []).some((d) => results[d]?.blocked);
    if (blocked && preset.enabled) {
      preset.enabled = false;
      changed = true;
    }
  }

  await saveState(state);
  if (changed) await applyProxy(state);
}

// --- helpers --------------------------------------------------------------

async function refreshActiveTabIcon(state) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await refreshTabIcon(tab.id, state);
}

async function refreshTabIcon(tabId, state) {
  const theme = state?.resolvedTheme === 'dark' ? 'dark' : 'light';
  if (!state || !state.enabled) {
    await setIconState(tabId, 'off', { theme });
    return;
  }
  if (!state.proxy || !state.proxy.host) {
    await setIconState(tabId, 'error', { reason: 'not configured', theme });
    return;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url || !tab.url.startsWith('http')) {
    await setIconState(tabId, 'direct', { host: '(internal)', theme });
    return;
  }

  const host = new URL(tab.url).hostname;
  const isRouted = isHostRouted(host, state);
  if (isRouted) {
    await setIconState(tabId, 'routed', {
      host,
      country: state.proxy.lastTest?.country,
      latencyMs: state.proxy.lastTest?.latencyMs,
      theme,
    });
  } else {
    await setIconState(tabId, 'direct', { host, theme });
  }
}

// --- popup messaging ------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'TEST_PROXY') {
    runProxyTest('https://ipinfo.io/json').then(sendResponse);
    return true; // async response
  }
  if (msg?.type === 'TEST_SERVICE') {
    // Sanitize to a bare hostname before building the URL (defensive — domain
    // comes from a runtime message).
    const domain = String(msg.domain || '').replace(/[^a-z0-9.-]/gi, '');
    if (!domain) { sendResponse({ ok: false, error: 'нет домена для проверки' }); return false; }
    runProxyTest(`https://${domain}/`).then(sendResponse);
    return true;
  }
  if (msg?.type === 'DETECT_SCHEME') {
    // Fire-and-forget: run detection in background, write result to storage.
    // Popup watches storage changes to update UI.
    detectScheme(msg.host, msg.port, msg.user, msg.pass);
    sendResponse({ started: true });
    return false;
  }
  if (msg?.type === 'CHECK_DOMAIN') {
    checkDomain(msg.domain)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ blocked: false, reason: `error: ${err.message}` }));
    return true;
  }
  if (msg?.type === 'RKN_CHECK') {
    (async () => {
      const st = await loadState();
      await runRknCheck(st);
      sendResponse(st.rknResults || {});
    })();
    return true;
  }

  if (msg?.type === 'SWITCH_SOURCE') {
    (async () => {
      try {
        const state = await loadState();
        state.proxySource = (msg.source === 'free' || msg.source === 'own') ? msg.source : 'manual';
        if (state.proxySource === 'manual') {
          state.proxy = state.manualProxy ? { ...state.manualProxy } : null;
          await saveState(state);
          sendResponse({ ok: true, state });
          return;
        }
        if (state.proxySource === 'own') {
          const ns = await selectOwnProxy(state, { markCurrentDead: false });
          sendResponse({ ok: !!ns.ownPool?.selected, state: ns });
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
      } catch (err) {
        console.error('[bg] SWITCH_SOURCE failed:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === 'ROTATE_FREE') {
    (async () => {
      try {
        const state = await loadState();
        const newState = await rotateFreeProxy(state, { markCurrentDead: true });
        sendResponse({ ok: !!newState.freeProxy.selected, state: newState });
      } catch (err) {
        console.error('[bg] ROTATE_FREE failed:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === 'SET_OWN_POOL') {
    (async () => {
      try {
        const state = await loadState();
        state.ownPool = state.ownPool || { proxies: [], deadHosts: {}, selected: null, lastError: null };
        state.ownPool.raw = String(msg.raw || '');
        state.ownPool.proxies = Array.isArray(msg.proxies) ? msg.proxies : [];
        state.ownPool.deadHosts = {};        // fresh list → forget old dead marks
        state.ownPool.selected = null;
        if (state.proxySource === 'own') {
          const ns = await selectOwnProxy(state, { markCurrentDead: false });
          sendResponse({ ok: !!ns.ownPool?.selected, state: ns });
        } else {
          await saveState(state);
          sendResponse({ ok: true, state });
        }
      } catch (err) {
        console.error('[bg] SET_OWN_POOL failed:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === 'ROTATE_OWN') {
    (async () => {
      try {
        const state = await loadState();
        const ns = await selectOwnProxy(state, { markCurrentDead: true });
        sendResponse({ ok: !!ns.ownPool?.selected, state: ns });
      } catch (err) {
        console.error('[bg] ROTATE_OWN failed:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

});

async function runProxyTest(url) {
  const state = await loadState();
  if (!state.proxy?.host) return { ok: false, error: 'No proxy configured' };
  const r = await probeThroughProxy(url, state.proxy, { timeoutMs: 8000, parseJson: url.includes('ipinfo.io') });
  if (!r.ok) { await applyProxy(state); return { ok: false, error: r.error }; }
  let extra = {};
  if (url.includes('ipinfo.io') && r.json) {
    extra = { ip: r.json.ip, country: r.json.country };
    state.proxy.lastTest = { ok: true, ip: r.json.ip, country: r.json.country, latencyMs: r.latencyMs, at: Math.floor(Date.now() / 1000) };
    await saveState(state);
  } else {
    extra = { httpStatus: r.status };
  }
  await applyProxy(state);
  return { ok: true, latencyMs: r.latencyMs, ...extra };
}

/**
 * Mark the current free proxy as dead, find a new one, and update state.
 * Returns the new state (or unchanged if no new proxy found and no current to remove).
 */
let rotationInProgress = false;

async function rotateFreeProxy(state, { markCurrentDead = true } = {}) {
  if (state.proxySource !== 'free') return state;
  if (rotationInProgress) return state;  // another rotation is already running
  rotationInProgress = true;
  try {
    if (markCurrentDead && state.proxy?.host) {
      const key = `${state.proxy.host}:${state.proxy.port}`;
      state.freeProxy.deadHosts[key] = Date.now() + DEAD_HOST_TTL_MS;
    }

    const result = await pickAndValidate(state, {
      onProgress: (index, total, cand) => {
        // Best-effort: push progress to popup if open. No receiver = no problem.
        chrome.runtime.sendMessage({
          type: 'FREE_PROGRESS',
          index,
          total,
          host: cand.host,
          port: cand.port,
        }).catch(() => { /* popup closed */ });
      },
    });
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
  } finally {
    rotationInProgress = false;
  }
}

/**
 * Periodic free-pool refresh (chrome.alarms 'free-pool-refresh', every 5 min =
 * the Proxifly list TTL). No-op unless enabled and on the free pool.
 *
 * Deliberately does NOT actively re-validate a *working* selected proxy: that
 * would require hijacking chrome.proxy.settings (validateProxy routes traffic
 * through the candidate), blipping every routed domain — including an active
 * stream — every 5 minutes, and briefly exposing non-preset traffic to an
 * untrusted free proxy. Instead:
 *   - no working proxy selected → pick one now (settings hijack during the pick
 *     is harmless: routing is already DIRECT, nothing live to disrupt). This
 *     auto-recovers a pool that dropped while the user was idle.
 *   - working proxy selected    → just refresh the Proxifly list (a plain GET,
 *     no proxy hijack) and bump poolFetchedAt so "Список обновлён N мин назад" is
 *     honest. A proxy that dies mid-use is rotated reactively by handleProxyError
 *     the moment a routed request fails.
 */
async function refreshFreeProxy() {
  const state = await loadState();
  if (!state.enabled || state.proxySource !== 'free') return;
  if (rotationInProgress) return;

  if (!state.freeProxy?.selected) {
    await rotateFreeProxy(state, { markCurrentDead: false });
    return;
  }

  await fetchPool({ force: true });
  state.freeProxy.poolFetchedAt = Date.now();
  await saveState(state);
}

function registerProxyErrorListener() {
  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      handleProxyError(details).catch((err) => {
        console.error('[bg] handleProxyError failed:', err);
      });
    },
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
  // Firefox (NS_ERROR_*) — same failures, different code strings.
  'NS_ERROR_PROXY_CONNECTION_REFUSED',
  'NS_ERROR_UNKNOWN_PROXY_HOST',
  'NS_ERROR_PROXY_AUTHENTICATION_FAILED',
  'NS_ERROR_PROXY_BAD_GATEWAY',
  'NS_ERROR_PROXY_GATEWAY_TIMEOUT',
]);

const ROTATE_DEBOUNCE_MS = 10_000;

async function handleProxyError(details) {
  if (!PROXY_ERROR_CODES.has(details.error)) return;

  const now = Date.now();
  const last = globalThis.__lastRotateAt || 0;
  if (now - last < ROTATE_DEBOUNCE_MS) return;
  globalThis.__lastRotateAt = now;

  const state = await loadState();
  if (state.proxySource === 'free') {
    await rotateFreeProxy(state, { markCurrentDead: true });
  } else if (state.proxySource === 'own') {
    await selectOwnProxy(state, { markCurrentDead: true });
  }
}

// Pick the next live proxy from the user's own pool (proxySource === 'own').
// Optimistic — no upfront validation: private proxies need auth that only kicks
// in via onAuthRequired on state.proxy. A dead pick is rotated reactively by
// handleProxyError; "Проверить прокси" verifies the current one (with auth).
async function selectOwnProxy(state, { markCurrentDead = true } = {}) {
  if (state.proxySource !== 'own') return state;
  const pool = state.ownPool = state.ownPool
    || { raw: '', proxies: [], deadHosts: {}, selected: null, lastError: null };
  pool.deadHosts = pool.deadHosts || {};
  const now = Date.now();
  for (const k of Object.keys(pool.deadHosts)) if (pool.deadHosts[k] < now) delete pool.deadHosts[k];
  if (markCurrentDead && pool.selected) {
    pool.deadHosts[`${pool.selected.host}:${pool.selected.port}`] = now + DEAD_HOST_TTL_MS;
  }
  const next = nextLiveProxy(pool.proxies, pool.deadHosts, now);
  if (next) {
    pool.selected = { ...next };
    pool.lastError = null;
    state.proxy = {
      host: next.host,
      port: Number(next.port),
      scheme: next.scheme || 'http',
      user: next.user || '',
      pass: next.pass || '',
      lastTest: null,
    };
  } else {
    pool.selected = null;
    pool.lastError = (pool.proxies || []).length
      ? 'Все твои прокси временно недоступны — подожди или проверь адреса.'
      : 'Список пуст — вставь свои прокси.';
    state.proxy = null;
  }
  await saveState(state);
  return state;
}

// Auto-detect which protocol the proxy speaks.
// Writes progress to state.detectStatus so the popup reacts via storage listener.
async function detectScheme(host, port, user, pass) {
  const candidates = ['http', 'socks5', 'socks4', 'https'];
  const state = await loadState();
  const origProxy = state.proxy;

  state.proxy = { host, port: Number(port), scheme: 'auto', user: user || '', pass: pass || '' };
  state.detectStatus = { running: true, trying: candidates[0] };
  await saveState(state);
  await new Promise((r) => setTimeout(r, 100));

  for (const scheme of candidates) {
    state.detectStatus = { running: true, trying: scheme };
    await saveState(state);
    const r = await probeThroughProxy('https://ipinfo.io/json', { scheme, host, port: Number(port) }, { timeoutMs: 4000 });
    if (r.ok) {
      state.proxy.scheme = scheme;
      state.detectStatus = { running: false, ok: true, scheme };
      await saveState(state);
      await applyProxy(state);
      return;
    }
  }

  state.proxy = origProxy;
  state.detectStatus = { running: false, ok: false, error: 'Could not detect protocol' };
  await saveState(state);
  if (origProxy) await applyProxy(state);
}
