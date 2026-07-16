import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Firefox env: chrome.proxy.onRequest present.
let onRequestHandler = null;
beforeEach(() => {
  onRequestHandler = null;
  globalThis.chrome = {
    proxy: {
      onRequest: { addListener: (fn) => { onRequestHandler = fn; } },
      settings: { set: async () => {}, clear: async () => {} },
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    webRequest: { onAuthRequired: { addListener: () => {} } },
  };
});

const ROUTED_STATE = {
  enabled: true,
  proxy: { scheme: 'socks5', host: '1.2.3.4', port: 1080, user: 'u', pass: 'p' },
  presets: { gemini: { enabled: true, domains: ['gemini.google.com'] } },
  customDomains: [],
};

test('ffDescriptor: socks5 → type socks + инлайн-авторизация + proxyDNS', async () => {
  const { ffDescriptor } = await import(`../extension/lib/proxy-backend.js?d=${Date.now()}`);
  const d = ffDescriptor({ scheme: 'socks5', host: '1.2.3.4', port: 1080, user: 'u', pass: 'p' });
  assert.equal(d.type, 'socks');
  assert.equal(d.host, '1.2.3.4');
  assert.equal(d.port, 1080);
  assert.equal(d.username, 'u');
  assert.equal(d.password, 'p');
  assert.equal(d.proxyDNS, true);
});

test('ffDescriptor: http без авторизации → без username', async () => {
  const { ffDescriptor } = await import(`../extension/lib/proxy-backend.js?d=${Date.now()}`);
  const d = ffDescriptor({ scheme: 'http', host: '9.9.9.9', port: 8080 });
  assert.equal(d.type, 'http');
  assert.equal(d.username, undefined);
  assert.equal(d.proxyDNS, undefined);
});

test('Firefox applyProxy → onRequest роутит совпавший хост, иначе direct', async () => {
  const m = await import(`../extension/lib/proxy-backend.js?r=${Date.now()}`);
  await m.applyProxy(ROUTED_STATE);
  assert.ok(onRequestHandler, 'listener зарегистрирован');
  const routed = onRequestHandler({ url: 'https://gemini.google.com/app' });
  assert.equal(routed.type, 'socks');
  assert.equal(routed.host, '1.2.3.4');
  const direct = onRequestHandler({ url: 'https://example.com/' });
  assert.deepEqual(direct, { type: 'direct' });
});

test('Firefox clearProxy → onRequest возвращает direct', async () => {
  const m = await import(`../extension/lib/proxy-backend.js?c=${Date.now()}`);
  await m.applyProxy(ROUTED_STATE);
  await m.clearProxy();
  assert.deepEqual(onRequestHandler({ url: 'https://gemini.google.com/app' }), { type: 'direct' });
});

test('Firefox validateProxy: probe-override роутит тест-URL через кандидата', async () => {
  const m = await import(`../extension/lib/proxy-backend.js?v=${Date.now()}`);
  let routedThroughCandidate = false;
  globalThis.fetch = async (url) => {
    const d = onRequestHandler({ url });
    routedThroughCandidate = d.type === 'socks' && d.host === '5.6.7.8';
    return { ok: true, status: 200 };
  };
  const r = await m.validateProxy({ protocol: 'socks5', host: '5.6.7.8', port: 1080 });
  assert.equal(r.ok, true);
  assert.equal(routedThroughCandidate, true);
  assert.deepEqual(onRequestHandler({ url: 'https://example.com/' }), { type: 'direct' });
});

// Chrome env helper: chrome.proxy WITHOUT onRequest → isFirefox=false → chromeApply path.
// Tracks every set/clear call (with the PAC data passed) and the "live" browser
// setting, so tests can assert what the network stack would actually be using.
function chromeEnv({ levelOfControl = 'controlled_by_this_extension' } = {}) {
  let setCount = 0;
  let clearCount = 0;
  const calls = [];        // [{op: 'set', data} | {op: 'clear'}] in order
  let liveValue = null;    // what the browser proxy setting currently holds
  globalThis.chrome = {
    proxy: {
      settings: {
        set: async ({ value }) => {
          setCount++;
          liveValue = value?.pacScript?.data ?? null;
          calls.push({ op: 'set', data: liveValue });
        },
        clear: async () => {
          clearCount++;
          liveValue = null;
          calls.push({ op: 'clear' });
        },
        get: async () => ({ levelOfControl }),
      },
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    webRequest: { onAuthRequired: { addListener: () => {} } },
  };
  return { counts: () => ({ setCount, clearCount }), calls, live: () => liveValue };
}

test('Chrome applyProxy: re-applying identical state does NOT re-set PAC', async () => {
  const env = chromeEnv();
  const m = await import(`../extension/lib/proxy-backend.js?dedupe=${Date.now()}`);
  await m.applyProxy(ROUTED_STATE);
  await m.applyProxy(ROUTED_STATE); // identical PAC → must skip the redundant set
  assert.equal(env.counts().setCount, 1);
});

test('Chrome applyProxy: changed proxy host DOES re-set PAC', async () => {
  const env = chromeEnv();
  const m = await import(`../extension/lib/proxy-backend.js?changed=${Date.now()}`);
  await m.applyProxy(ROUTED_STATE);
  await m.applyProxy({ ...ROUTED_STATE, proxy: { ...ROUTED_STATE.proxy, host: '9.9.9.9' } });
  assert.equal(env.counts().setCount, 2);
});

// Regression (0.16.4): chromeProbe cleared the proxy settings in finally without
// resetting lastAppliedPac, so the follow-up applyProxy() saw "unchanged" and
// skipped the re-set — every "Проверить прокси" left the browser with NO proxy
// (real-IP leak) until the next service-worker restart.
test('Chrome probe: restores the routing PAC after the probe (not cleared)', async () => {
  const env = chromeEnv();
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  const m = await import(`../extension/lib/proxy-backend.js?probe1=${Date.now()}`);
  await m.applyProxy(ROUTED_STATE);
  const routingPac = env.live();
  assert.match(routingPac, /dnsDomainIs/, 'sanity: routing PAC is live before probe');

  const r = await m.probeThroughProxy('https://example.test/x', ROUTED_STATE.proxy, { timeoutMs: 1000 });
  assert.equal(r.ok, true);
  assert.equal(env.live(), routingPac, 'routing PAC is live again after the probe');
});

test('Chrome probe: with no PAC applied, ends cleared (no stray probe PAC)', async () => {
  const env = chromeEnv();
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  const m = await import(`../extension/lib/proxy-backend.js?probe2=${Date.now()}`);
  await m.probeThroughProxy('https://example.test/x', ROUTED_STATE.proxy, { timeoutMs: 1000 });
  assert.equal(env.live(), null, 'browser proxy setting is cleared after the probe');
});

test('Chrome clearProxy resets the PAC cache → applyProxy re-sets after clear', async () => {
  const env = chromeEnv();
  const m = await import(`../extension/lib/proxy-backend.js?clearcache=${Date.now()}`);
  await m.applyProxy(ROUTED_STATE);
  await m.clearProxy();
  await m.applyProxy(ROUTED_STATE); // same PAC string, but the browser was cleared
  assert.equal(env.counts().setCount, 2, 'PAC re-applied after clear despite identical string');
  assert.match(env.live(), /dnsDomainIs/, 'routing PAC live again');
});

// proxyControlStatus: Chrome resolves extension conflicts by install time; a
// losing set() is silently ignored, so surfacing levelOfControl is the only way
// to tell the user why "everything is green" yet traffic bypasses the proxy.
test('proxyControlStatus: controlled_by_this_extension → ok', async () => {
  chromeEnv({ levelOfControl: 'controlled_by_this_extension' });
  const m = await import(`../extension/lib/proxy-backend.js?ctl1=${Date.now()}`);
  assert.equal(await m.proxyControlStatus(), 'ok');
});

test('proxyControlStatus: controlled_by_other_extensions → other_extension', async () => {
  chromeEnv({ levelOfControl: 'controlled_by_other_extensions' });
  const m = await import(`../extension/lib/proxy-backend.js?ctl2=${Date.now()}`);
  assert.equal(await m.proxyControlStatus(), 'other_extension');
});

test('proxyControlStatus: not_controllable → system', async () => {
  chromeEnv({ levelOfControl: 'not_controllable' });
  const m = await import(`../extension/lib/proxy-backend.js?ctl3=${Date.now()}`);
  assert.equal(await m.proxyControlStatus(), 'system');
});

test('proxyControlStatus: Firefox (onRequest backend) → always ok, no settings.get', async () => {
  // beforeEach set the Firefox env (proxy.onRequest present, no settings.get at all).
  const m = await import(`../extension/lib/proxy-backend.js?ctlff=${Date.now()}`);
  assert.equal(await m.proxyControlStatus(), 'ok');
});
