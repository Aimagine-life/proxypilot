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
