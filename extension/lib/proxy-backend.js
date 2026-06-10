// Platform proxy backend. Chrome uses a PAC script via chrome.proxy.settings;
// Firefox (Task 3) uses chrome.proxy.onRequest. Routing logic (isHostRouted) is
// shared from pac.js so both backends route identically.
import { buildPacScript, isHostRouted } from './pac.js';

const VALIDATE_URL = 'https://detectportal.firefox.com/success.txt';
const VALIDATE_TIMEOUT_MS = 4_000;

// Firefox exposes its promise APIs on `browser` natively (Chrome has no `browser`).
// After the compat shim, `chrome` === `browser` in Firefox; detect by presence of
// chrome.proxy.onRequest (available in Firefox, absent in Chrome).
const isFirefox = typeof chrome !== 'undefined' && !!(chrome.proxy && chrome.proxy.onRequest);

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
async function chromeApply(state) {
  const pac = buildPacScript(state);
  if (pac === null) { await chrome.proxy.settings.clear({ scope: 'regular' }); return { applied: false }; }
  await chrome.proxy.settings.set({
    value: { mode: 'pac_script', pacScript: { data: pac, mandatory: true } },
    scope: 'regular',
  });
  return { applied: true };
}
async function chromeClear() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
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
    await chrome.proxy.settings.clear({ scope: 'regular' });
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
export { VALIDATE_URL }; // exported for tests
