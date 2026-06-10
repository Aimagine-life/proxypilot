// Platform proxy backend. Chrome uses a PAC script via chrome.proxy.settings;
// Firefox (Task 3) uses chrome.proxy.onRequest. Routing logic (isHostRouted) is
// shared from pac.js so both backends route identically.
import { buildPacScript } from './pac.js';

const VALIDATE_URL = 'https://detectportal.firefox.com/success.txt';
const VALIDATE_TIMEOUT_MS = 4_000;

// Firefox exposes chrome.proxy.onRequest (after the compat shim); Chrome does not.
const isFirefox = !!(globalThis.chrome && chrome.proxy && chrome.proxy.onRequest);

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
  await chrome.proxy.settings.set({
    value: { mode: 'pac_script', pacScript: { data: allThroughPac(proxy), mandatory: true } },
    scope: 'regular',
  });
  try {
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

// ---- public API ----
export async function applyProxy(state) {
  return chromeApply(state);
}
export async function clearProxy() {
  return chromeClear();
}
/** Route `url` through `proxy` once; resolve to { ok, status, json?, latencyMs, error }. */
export async function probeThroughProxy(url, proxy, { timeoutMs = VALIDATE_TIMEOUT_MS, parseJson = false } = {}) {
  const start = Date.now();
  try {
    const res = await chromeProbe(url, proxy, timeoutMs);
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
  const r = await probeThroughProxy(VALIDATE_URL, {
    scheme: candidate.protocol, host: candidate.host, port: candidate.port,
  }, { timeoutMs: VALIDATE_TIMEOUT_MS });
  return { ok: r.ok, latencyMs: r.latencyMs, error: r.error };
}
export function registerProxyAuth(loadState) {
  if (isFirefox) return; // Firefox: inline auth in the proxy descriptor (Task 3)
  chromeRegisterAuth(loadState);
}
export { VALIDATE_URL };
