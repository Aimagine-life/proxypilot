// Platform proxy backend. Chrome uses a PAC script via chrome.proxy.settings;
// Firefox (Task 3) uses chrome.proxy.onRequest. Routing logic (isHostRouted) is
// shared from pac.js so both backends route identically.
import { buildPacScript, isHostRouted } from './pac.js';

const VALIDATE_URL = 'https://detectportal.firefox.com/success.txt';
const VALIDATE_TIMEOUT_MS = 4_000;

// Firefox exposes its promise APIs on `browser` natively (Chrome has no `browser`).
// After the compat shim, `chrome` === `browser` in Firefox; detect by presence of
// chrome.proxy.onRequest (available in Firefox, absent in Chrome).
export const isFirefox = typeof chrome !== 'undefined' && !!(chrome.proxy && chrome.proxy.onRequest);

// ---- shared ----
function pacDirective({ scheme, host, port }) {
  switch (scheme) {
    case 'https':  return `HTTPS ${host}:${port}`;
    case 'socks5': return `SOCKS5 ${host}:${port}; SOCKS ${host}:${port}`;
    case 'socks4': return `SOCKS ${host}:${port}`;
    default:       return `PROXY ${host}:${port}`;
  }
}
function allThroughPac(proxy) {
  return `function FindProxyForURL(url, host) { return "${pacDirective(proxy)}"; }`;
}

// ---- Chrome backend ----
// Skip redundant PAC re-applies. Re-setting chrome.proxy.settings tears down
// in-flight connections during the swap, so an unrelated state write (e.g.
// donate.uses++ when the popup opens) must not churn the proxy. Track the last
// PAC string applied this service-worker lifetime; a SW restart resets it to
// undefined so the first post-wake apply always runs.
let lastAppliedPac;
async function chromeApply(state) {
  const pac = buildPacScript(state);
  if (pac === null) {
    if (lastAppliedPac !== null) {
      await chrome.proxy.settings.clear({ scope: 'regular' });
      lastAppliedPac = null;
    }
    return { applied: false };
  }
  if (pac === lastAppliedPac) return { applied: true, unchanged: true };
  await chrome.proxy.settings.set({
    value: { mode: 'pac_script', pacScript: { data: pac, mandatory: true } },
    scope: 'regular',
  });
  lastAppliedPac = pac;
  return { applied: true };
}
async function chromeClear() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
  // The browser now has no PAC; without this reset chromeApply would compare the
  // next PAC against the stale string, see "unchanged", and skip the re-set.
  lastAppliedPac = null;
}
async function chromeProbe(url, proxy, timeoutMs) {
  try {
    await chrome.proxy.settings.set({
      value: { mode: 'pac_script', pacScript: { data: allThroughPac(proxy), mandatory: true } },
      scope: 'regular',
    });
    // Chrome applies the new PAC to the network stack slightly after set() resolves;
    // wait briefly so the very next fetch goes through THIS proxy, not the previous one.
    await new Promise((r) => setTimeout(r, 50));
    return await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } finally {
    // Restore the routing PAC that was live before the probe. Clearing and relying
    // on the caller's later applyProxy() is not enough: chromeApply skips the
    // re-set when the PAC string is unchanged (lastAppliedPac), which used to
    // leave the browser with NO proxy after every test — a silent real-IP leak
    // until the next service-worker restart.
    if (typeof lastAppliedPac === 'string') {
      await chrome.proxy.settings.set({
        value: { mode: 'pac_script', pacScript: { data: lastAppliedPac, mandatory: true } },
        scope: 'regular',
      });
    } else {
      await chrome.proxy.settings.clear({ scope: 'regular' });
      lastAppliedPac = null;
    }
  }
}
function chromeRegisterAuth(loadState) {
  chrome.webRequest.onAuthRequired.addListener(
    (details, callback) => {
      if (!details.isProxy) { callback({}); return; }
      loadState()
        .then((state) => {
          const proxy = state?.proxy;
          if (!proxy?.user) { callback({}); return; }
          callback({ authCredentials: { username: proxy.user, password: proxy.pass || '' } });
        })
        .catch(() => callback({}));
    },
    { urls: ['<all_urls>'] },
    ['asyncBlocking'],
  );
}

// ---- Firefox backend ----
const FF_TYPE = { http: 'http', https: 'https', socks5: 'socks', socks4: 'socks4', auto: 'http' };
let ffState = null;
let ffListenerAdded = false;
const ffProbes = new Map(); // url → proxy (временные override для validateProxy/probe)

export function ffDescriptor(proxy) {
  const type = FF_TYPE[proxy.scheme] || 'http';
  const d = { type, host: proxy.host, port: Number(proxy.port) };
  if (proxy.user) { d.username = proxy.user; d.password = proxy.pass || ''; }
  if (type === 'socks') d.proxyDNS = true; // remote DNS — SOCKS5 only (SOCKS4 sends IP)
  return d;
}
export function ffHandleRequest(info) {
  const probe = ffProbes.get(info.url);
  if (probe) return ffDescriptor(probe);
  if (!ffState || !ffState.enabled || !ffState.proxy?.host) return { type: 'direct' };
  let host;
  try { host = new URL(info.url).hostname; } catch { return { type: 'direct' }; }
  return isHostRouted(host, ffState) ? ffDescriptor(ffState.proxy) : { type: 'direct' };
}
function ffEnsureListener() {
  if (ffListenerAdded) return;
  chrome.proxy.onRequest.addListener(ffHandleRequest, { urls: ['<all_urls>'] });
  ffListenerAdded = true;
}
async function ffProbeThrough(url, proxy, timeoutMs) {
  ffEnsureListener();
  ffProbes.set(url, proxy);
  try {
    return await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } finally {
    ffProbes.delete(url);
  }
}

// ---- public API ----
export async function applyProxy(state) {
  if (isFirefox) { ffState = state; ffEnsureListener(); return { applied: !!(state.enabled && state.proxy?.host) }; }
  return chromeApply(state);
}
export async function clearProxy() {
  if (isFirefox) { ffState = ffState ? { ...ffState, enabled: false } : null; return; }
  return chromeClear();
}
/** Route `url` through `proxy` once; resolve to { ok, status, json?, latencyMs, error }. */
export async function probeThroughProxy(url, proxy, { timeoutMs = VALIDATE_TIMEOUT_MS, parseJson = false } = {}) {
  const start = Date.now();
  try {
    const res = isFirefox
      ? await ffProbeThrough(url, proxy, timeoutMs)
      : await chromeProbe(url, proxy, timeoutMs);
    const latencyMs = Date.now() - start;
    const out = { ok: res.ok, status: res.status, latencyMs, error: res.ok ? null : `HTTP ${res.status}` };
    if (parseJson && res.ok) { try { out.json = await res.json(); } catch { /* ignore */ } }
    return out;
  } catch (err) {
    return { ok: false, status: 0, latencyMs: Date.now() - start, error: String(err?.message || err) };
  }
}
/** Validate a free-pool candidate { protocol, host, port }. */
export async function validateProxy(candidate) {
  // NormalizedProxy uses 'protocol'; probe uses 'scheme' — explicit mapping.
  const r = await probeThroughProxy(VALIDATE_URL, {
    scheme: candidate.protocol, host: candidate.host, port: candidate.port,
  }, { timeoutMs: VALIDATE_TIMEOUT_MS });
  return { ok: r.ok, latencyMs: r.latencyMs, error: r.error };
}
export function registerProxyAuth(loadState) {
  if (isFirefox) return; // Firefox: inline auth in the proxy descriptor (Task 3)
  chromeRegisterAuth(loadState);
}
/**
 * Who effectively owns the browser proxy settings. Chrome resolves conflicts
 * between extensions by install time (most recently installed wins), and a
 * losing set() is silently ignored — the extension believes it's routing while
 * traffic bypasses the proxy entirely (shows the user's real IP). Returns
 * 'other_extension' when another extension holds the setting, 'system' when
 * enterprise policy / the OS locks it, 'ok' otherwise. Firefox's backend is
 * proxy.onRequest — no shared setting to fight over — so it's always 'ok'.
 */
export async function proxyControlStatus() {
  if (isFirefox) return 'ok';
  const { levelOfControl } = await chrome.proxy.settings.get({});
  if (levelOfControl === 'controlled_by_other_extensions') return 'other_extension';
  if (levelOfControl === 'not_controllable') return 'system';
  return 'ok';
}
export { VALIDATE_URL }; // exported for tests
