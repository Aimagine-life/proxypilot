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

import { fetchPool, __resetMemoryCache } from '../extension/lib/free-pool.js';

const SAMPLE_POOL = [
  { proxy: 'socks5://1.2.3.4:1080', protocol: 'socks5', ip: '1.2.3.4', port: 1080, geolocation: { country: 'NL' } },
  { proxy: 'http://5.6.7.8:8080',   protocol: 'http',   ip: '5.6.7.8', port: 8080, geolocation: { country: 'DE' } },
  { proxy: 'socks4://9.9.9.9:1234', protocol: 'socks4', ip: '9.9.9.9', port: 1234, geolocation: { country: 'US' } },
];

test('fetchPool: parses Proxifly JSON array', async () => {
  __resetMemoryCache();
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(SAMPLE_POOL) }));
  const pool = await fetchPool({ force: true });
  assert.equal(pool.length, 3);
  assert.deepEqual(pool[0], { host: '1.2.3.4', port: 1080, protocol: 'socks5', country: 'NL' });
  assert.deepEqual(pool[1], { host: '5.6.7.8', port: 8080, protocol: 'http',   country: 'DE' });
});

test('fetchPool: parses NDJSON', async () => {
  __resetMemoryCache();
  const ndjson = SAMPLE_POOL.map((e) => JSON.stringify(e)).join('\n');
  mockFetchResponses.push(mockResponse({ text: ndjson }));
  const pool = await fetchPool({ force: true });
  assert.equal(pool.length, 3);
  assert.equal(pool[0].host, '1.2.3.4');
});

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
  // Force identity order: Math.random near 1 makes Fisher-Yates j===i → no-op swaps.
  const origRandom = Math.random;
  Math.random = () => 0.999;
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
