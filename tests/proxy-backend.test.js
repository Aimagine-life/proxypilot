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
function chromeEnv() {
  let setCount = 0;
  let clearCount = 0;
  globalThis.chrome = {
    proxy: { settings: { set: async () => { setCount++; }, clear: async () => { clearCount++; } } },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    webRequest: { onAuthRequired: { addListener: () => {} } },
  };
  return { counts: () => ({ setCount, clearCount }) };
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

// Регрессия: chromeProbe очищает реальные настройки прокси в finally. Если после
// этого applyProxy с ТЕМ ЖЕ state пропустит set из-за dedupe-кэша, роутинг молча
// останется выключенным после каждого «Проверить прокси» / автоопределения схемы.
test('Chrome probeThroughProxy: applyProxy after a probe re-sets PAC (probe cleared real settings)', async () => {
  const env = chromeEnv();
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  const m = await import(`../extension/lib/proxy-backend.js?probe=${Date.now()}`);
  await m.applyProxy(ROUTED_STATE);                                   // set #1
  const r = await m.probeThroughProxy('https://probe.test/', ROUTED_STATE.proxy, { timeoutMs: 200 }); // set #2 + clear
  assert.equal(r.ok, true);
  await m.applyProxy(ROUTED_STATE);                                   // must set again — settings are cleared
  assert.equal(env.counts().setCount, 3);
  assert.equal(env.counts().clearCount, 1);
});

test('Chrome clearProxy: applyProxy of the same state after clear re-sets PAC', async () => {
  const env = chromeEnv();
  const m = await import(`../extension/lib/proxy-backend.js?clear=${Date.now()}`);
  await m.applyProxy(ROUTED_STATE);
  await m.clearProxy();
  await m.applyProxy(ROUTED_STATE);
  assert.equal(env.counts().setCount, 2);
});
