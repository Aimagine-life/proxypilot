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

function ok204() {
  return mockResponse({ ok: true, status: 204, text: '' });
}

import { fetchPool, __resetMemoryCache, fetchAllSources, SOURCES } from '../extension/lib/free-pool.js';

const SAMPLE_POOL = [
  { proxy: 'socks5://1.2.3.4:1080', protocol: 'socks5', ip: '1.2.3.4', port: 1080, anonymity: 'elite',  score: 100, geolocation: { country: 'NL' } },
  { proxy: 'http://5.6.7.8:8080',   protocol: 'http',   ip: '5.6.7.8', port: 8080, anonymity: 'anonymous', score: 80,  geolocation: { country: 'DE' } },
  { proxy: 'socks4://9.9.9.9:1234', protocol: 'socks4', ip: '9.9.9.9', port: 1234, anonymity: 'elite',  score: 50,  geolocation: { country: 'US' } },
];

test('SOURCES: 6 источников с обязательными полями', () => {
  assert.equal(SOURCES.length, 6);
  for (const s of SOURCES) {
    assert.ok(s.name && s.url && s.kind, `источник без обязательных полей: ${JSON.stringify(s)}`);
  }
});

test('fetchAllSources: склеивает успешные, дефолтный score применяется', async () => {
  const proxiflyOne = [{ protocol: 'socks5', ip: '1.2.3.4', port: 1080, anonymity: 'elite', score: 0, geolocation: { country: 'NL' } }];
  const monosansOne = [{ protocol: 'socks5', host: '5.6.7.8', port: 1080, geolocation: { country: { iso_code: 'US' } } }];
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(proxiflyOne) }));   // proxifly
  mockFetchResponses.push(mockResponse({ text: '[]' }));                          // proxyscrape
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(monosansOne) }));   // monosans (defaultScore)
  mockFetchResponses.push(mockResponse({ text: '' }));                            // zloi-http
  mockFetchResponses.push(mockResponse({ text: '' }));                            // zloi-socks5
  mockFetchResponses.push(mockResponse({ text: '' }));                            // hookzof
  const pool = await fetchAllSources();
  const mono = pool.find((p) => p.host === '5.6.7.8');
  assert.ok(mono, 'monosans запись присутствует');
  assert.ok(mono.score > 0, 'дефолтный score применён к фиду без score');
  assert.ok(pool.find((p) => p.host === '1.2.3.4'), 'proxifly запись присутствует');
});

test('fetchAllSources: один источник падает — пул собирается из остальных', async () => {
  mockFetchResponses.push(new Error('proxifly down'));                            // proxifly падает
  for (let i = 1; i < SOURCES.length - 1; i++) mockFetchResponses.push(mockResponse({ text: '[]' }));
  mockFetchResponses.push(mockResponse({ text: '9.9.9.9:1080\n' }));              // hookzof (txt socks5)
  const pool = await fetchAllSources();
  assert.ok(pool.find((p) => p.host === '9.9.9.9'));
});

test('fetchAllSources: все источники упали → throw', async () => {
  for (let i = 0; i < SOURCES.length; i++) mockFetchResponses.push(new Error('down'));
  await assert.rejects(() => fetchAllSources(), /источник/i);
});

// Хелпер: ставит ответы так, что только proxifly (1-й источник) отдаёт пул,
// остальные 5 «падают». Итоговый пул fetchPool === переданные записи.
function queuePool(poolArrayOrText) {
  const text = typeof poolArrayOrText === 'string' ? poolArrayOrText : JSON.stringify(poolArrayOrText);
  mockFetchResponses.push(mockResponse({ text }));                 // proxifly
  for (let i = 1; i < SOURCES.length; i++) mockFetchResponses.push(new Error('source down'));
}

test('fetchPool: память-кэш отдаёт те же данные без повторной сети', async () => {
  __resetMemoryCache();
  queuePool(SAMPLE_POOL);
  const first = await fetchPool({ force: true });
  const callsAfterFirst = mockFetchCalls.length;
  const second = await fetchPool();
  assert.equal(mockFetchCalls.length, callsAfterFirst);
  assert.equal(second.length, first.length);
});

test('fetchPool: chrome.storage кэш (формат {pool, at}) при холодной памяти', async () => {
  __resetMemoryCache();
  const cachedPool = [{ host: '1.2.3.4', port: 1080, protocol: 'socks5', country: 'NL', score: 100, anonymity: 'elite', httpsCapable: true }];
  mockStorage['freeProxyPoolCache'] = { pool: cachedPool, at: Date.now() - 60_000 };
  const pool = await fetchPool();
  assert.equal(mockFetchCalls.length, 0);
  assert.equal(pool[0].host, '1.2.3.4');
});

test('fetchPool: протухший storage-кэш → сеть', async () => {
  __resetMemoryCache();
  mockStorage['freeProxyPoolCache'] = { pool: [], at: Date.now() - (6 * 60 * 1000) };
  queuePool(SAMPLE_POOL);
  await fetchPool();
  assert.ok(mockFetchCalls.length > 0);
});

test('fetchPool: старый кэш {raw} (до 0.10.0) игнорируется → сеть', async () => {
  __resetMemoryCache();
  mockStorage['freeProxyPoolCache'] = { raw: SAMPLE_POOL, at: Date.now() - 60_000 };
  queuePool(SAMPLE_POOL);
  await fetchPool();
  assert.ok(mockFetchCalls.length > 0);
});

import { filterPool } from '../extension/lib/free-pool.js';

const BIG_POOL = [
  { host: '1.1.1.1', port: 80, protocol: 'http', country: 'NL', score: 50, anonymity: 'elite' },
  { host: '2.2.2.2', port: 80, protocol: 'http', country: 'RU', score: 90, anonymity: 'elite' },     // blocked country
  { host: '3.3.3.3', port: 80, protocol: 'http', country: 'BY', score: 90, anonymity: 'elite' },     // blocked country
  { host: '4.4.4.4', port: 80, protocol: 'http', country: 'CN', score: 90, anonymity: 'elite' },     // blocked country
  { host: '5.5.5.5', port: 80, protocol: 'http', country: 'IR', score: 90, anonymity: 'elite' },     // blocked country
  { host: '6.6.6.6', port: 80, protocol: 'http', country: 'DE', score: 70, anonymity: 'elite' },
  { host: '7.7.7.7', port: 80, protocol: 'http', country: null, score: 30, anonymity: 'anonymous' }, // unknown country — kept
  { host: '8.8.8.8', port: 80, protocol: 'http', country: 'US', score: 100, anonymity: 'elite' },
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

test('filterPool: drops ZZ (unknown) country entries', () => {
  const pool = [
    { host: '1.1.1.1', port: 80, protocol: 'http', country: 'ZZ', score: 100, anonymity: 'elite' },
    { host: '2.2.2.2', port: 80, protocol: 'http', country: 'NL', score: 50,  anonymity: 'elite' },
  ];
  const filtered = filterPool(pool, { deadHosts: {} });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].host, '2.2.2.2');
});

test('filterPool: drops transparent-anonymity entries', () => {
  const pool = [
    { host: '1.1.1.1', port: 80, protocol: 'http', country: 'NL', score: 100, anonymity: 'transparent' },
    { host: '2.2.2.2', port: 80, protocol: 'http', country: 'NL', score: 50,  anonymity: 'anonymous' },
    { host: '3.3.3.3', port: 80, protocol: 'http', country: 'NL', score: 30,  anonymity: 'elite' },
  ];
  const filtered = filterPool(pool, { deadHosts: {} });
  const hosts = new Set(filtered.map((p) => p.host));
  assert.equal(hosts.has('1.1.1.1'), false);
  assert.equal(hosts.size, 2);
});

test('filterPool: sorts by score DESC (highest first)', () => {
  const filtered = filterPool(BIG_POOL, { deadHosts: {} });
  // Expected after blocked-country filter: US(100), DE(70), NL(50), null(30)
  assert.equal(filtered[0].score, 100);
  assert.equal(filtered[filtered.length - 1].score, 30);
  for (let i = 1; i < filtered.length; i++) {
    assert.ok(filtered[i - 1].score >= filtered[i].score, `score not descending at ${i}`);
  }
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

test('validateProxy: 204 → ok=true', async () => {
  mockFetchResponses.push(ok204());
  const result = await validateProxy({ host: '1.2.3.4', port: 1080, protocol: 'socks5' });
  assert.equal(result.ok, true);
  assert.equal(typeof result.latencyMs, 'number');
  assert.ok(result.latencyMs >= 0);
  assert.equal(result.error, null);
});

test('validateProxy: 200 also accepted (some proxies rewrite 204→200)', async () => {
  mockFetchResponses.push(mockResponse({ ok: true, status: 200 }));
  const result = await validateProxy({ host: '1.2.3.4', port: 1080, protocol: 'socks5' });
  assert.equal(result.ok, true);
});

test('validateProxy: hits a provider-neutral probe (not Google/Cloudflare)', async () => {
  mockFetchResponses.push(ok204());
  await validateProxy({ host: '1.2.3.4', port: 1080, protocol: 'socks5' });
  assert.equal(mockFetchCalls.length, 1);
  assert.doesNotMatch(mockFetchCalls[0].url, /google\.com|cloudflare\.com/);
  assert.match(mockFetchCalls[0].url, /^https:\/\//);
});

test('validateProxy: sets and clears chrome.proxy.settings', async () => {
  mockFetchResponses.push(ok204());
  await validateProxy({ host: '1.2.3.4', port: 1080, protocol: 'socks5' });
  // After the call, mockProxyConfig should be null (cleared) — we cleared in finally.
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

test('pickAndValidate: first candidate alive → returns it with cand.country', async () => {
  __resetMemoryCache();
  const onePool = [{ protocol: 'socks5', ip: '1.2.3.4', port: 1080, anonymity: 'elite', score: 100, geolocation: { country: 'NL' } }];
  queuePool(onePool);                                                          // pool fetch
  mockFetchResponses.push(ok204());                                           // validate
  const result = await pickAndValidate({ freeProxy: { deadHosts: {} } });
  assert.equal(result.pick.host, '1.2.3.4');
  assert.equal(result.pick.scheme, 'socks5');
  assert.equal(result.pick.country, 'NL');  // taken from candidate
  assert.equal(result.error, null);
  assert.equal(result.poolSize, 1);
});

test('pickAndValidate: first 2 dead, 3rd alive → returns 3rd', async () => {
  __resetMemoryCache();
  // Stub Math.random near 1 — Fisher-Yates becomes no-op AND keeps the
  // already-by-score order (all scores equal) deterministic.
  const origRandom = Math.random;
  Math.random = () => 0.999;
  try {
    const pool = [
      { protocol: 'socks5', ip: '1.1.1.1', port: 1080, anonymity: 'elite', score: 50, geolocation: { country: 'NL' } },
      { protocol: 'socks5', ip: '2.2.2.2', port: 1080, anonymity: 'elite', score: 50, geolocation: { country: 'NL' } },
      { protocol: 'socks5', ip: '3.3.3.3', port: 1080, anonymity: 'elite', score: 50, geolocation: { country: 'NL' } },
    ];
    queuePool(pool);
    mockFetchResponses.push(new Error('dead 1'));
    mockFetchResponses.push(new Error('dead 2'));
    mockFetchResponses.push(ok204());
    const result = await pickAndValidate({ freeProxy: { deadHosts: {} } });
    assert.equal(result.pick.host, '3.3.3.3');
    assert.equal(result.attemptedHosts.length, 3);
  } finally {
    Math.random = origRandom;
  }
});

test('pickAndValidate: all dead → null pick with Russian error', async () => {
  __resetMemoryCache();
  const pool = [
    { protocol: 'socks5', ip: '1.1.1.1', port: 1080, anonymity: 'elite', score: 10, geolocation: { country: 'NL' } },
    { protocol: 'socks5', ip: '2.2.2.2', port: 1080, anonymity: 'elite', score: 10, geolocation: { country: 'NL' } },
  ];
  queuePool(pool);
  mockFetchResponses.push(new Error('dead'));
  mockFetchResponses.push(new Error('dead'));
  const result = await pickAndValidate({ freeProxy: { deadHosts: {} } });
  assert.equal(result.pick, null);
  assert.match(result.error, /Рабочий прокси не найден/);
  assert.equal(result.attemptedHosts.length, 2);
});

test('pickAndValidate: empty filtered pool → null pick with specific error', async () => {
  __resetMemoryCache();
  const pool = [
    { protocol: 'socks5', ip: '1.1.1.1', port: 1080, anonymity: 'elite', score: 100, geolocation: { country: 'RU' } }, // all blocked
  ];
  queuePool(pool);
  const result = await pickAndValidate({ freeProxy: { deadHosts: {} } });
  assert.equal(result.pick, null);
  assert.match(result.error, /нет подходящих прокси/);
});

test('pickAndValidate: pool fetch fails → null pick with fetch error', async () => {
  __resetMemoryCache();
  for (let i = 0; i < SOURCES.length; i++) mockFetchResponses.push(new Error('network down'));
  const result = await pickAndValidate({ freeProxy: { deadHosts: {} } });
  assert.equal(result.pick, null);
  assert.match(result.error, /не удалось загрузить список/);
});

test('pickAndValidate: iterates all candidates when count < MAX_VALIDATION_ATTEMPTS', async () => {
  __resetMemoryCache();
  // 20 candidates (< MAX_VALIDATION_ATTEMPTS), all dead — must try every single one.
  const pool = [];
  for (let i = 0; i < 20; i++) {
    pool.push({ protocol: 'socks5', ip: `10.0.0.${i + 1}`, port: 1080, anonymity: 'elite', score: 50, geolocation: { country: 'NL' } });
  }
  queuePool(pool);
  for (let i = 0; i < 20; i++) mockFetchResponses.push(new Error('dead'));
  const result = await pickAndValidate({ freeProxy: { deadHosts: {} } });
  assert.equal(result.pick, null);
  assert.equal(result.attemptedHosts.length, 20);
});

test('pickAndValidate: invokes onProgress before each validation', async () => {
  __resetMemoryCache();
  const pool = [
    { protocol: 'socks5', ip: '1.1.1.1', port: 1080, anonymity: 'elite', score: 50, geolocation: { country: 'NL' } },
    { protocol: 'socks5', ip: '2.2.2.2', port: 1080, anonymity: 'elite', score: 50, geolocation: { country: 'NL' } },
    { protocol: 'socks5', ip: '3.3.3.3', port: 1080, anonymity: 'elite', score: 50, geolocation: { country: 'NL' } },
  ];
  const origRandom = Math.random;
  Math.random = () => 0.999;
  try {
    queuePool(pool);
    mockFetchResponses.push(new Error('dead'));
    mockFetchResponses.push(new Error('dead'));
    mockFetchResponses.push(ok204());

    const calls = [];
    const result = await pickAndValidate(
      { freeProxy: { deadHosts: {} } },
      { onProgress: (i, total, cand) => calls.push({ i, total, host: cand.host }) },
    );
    assert.equal(result.pick.host, '3.3.3.3');
    assert.deepEqual(calls, [
      { i: 1, total: 3, host: '1.1.1.1' },
      { i: 2, total: 3, host: '2.2.2.2' },
      { i: 3, total: 3, host: '3.3.3.3' },
    ]);
  } finally {
    Math.random = origRandom;
  }
});

test('pickAndValidate: throwing onProgress does not break validation', async () => {
  __resetMemoryCache();
  const pool = [
    { protocol: 'socks5', ip: '1.1.1.1', port: 1080, anonymity: 'elite', score: 50, geolocation: { country: 'NL' } },
  ];
  queuePool(pool);
  mockFetchResponses.push(ok204());
  const result = await pickAndValidate(
    { freeProxy: { deadHosts: {} } },
    { onProgress: () => { throw new Error('UI gone'); } },
  );
  assert.equal(result.pick.host, '1.1.1.1');
});

import { MAX_VALIDATION_ATTEMPTS } from '../extension/lib/free-pool.js';

test('filterPool: HTTPS-capable proxies sort before http-only', () => {
  const kept = filterPool([
    { host: 'a', port: 80, protocol: 'http', country: 'NL', score: 10, anonymity: 'elite', httpsCapable: false },
    { host: 'b', port: 80, protocol: 'http', country: 'NL', score: 1,  anonymity: 'elite', httpsCapable: true },
  ], { deadHosts: {} });
  assert.equal(kept[0].host, 'b'); // https-capable first, despite lower score
});

test('pickAndValidate: caps probes at MAX_VALIDATION_ATTEMPTS', async () => {
  __resetMemoryCache();
  const n = MAX_VALIDATION_ATTEMPTS + 10;
  const pool = Array.from({ length: n }, (_, i) =>
    ({ protocol: 'socks5', ip: `9.9.9.${i}`, port: 1080, anonymity: 'elite', score: 1, geolocation: { country: 'NL' } }));
  queuePool(pool);
  for (let i = 0; i < n; i++) mockFetchResponses.push(new Error('dead'));
  const result = await pickAndValidate({ freeProxy: { deadHosts: {} } });
  assert.equal(result.pick, null);
  assert.equal(result.attemptedHosts.length, MAX_VALIDATION_ATTEMPTS);
});

import { nextLiveProxy } from '../extension/lib/free-pool.js';

test('nextLiveProxy: skips dead-marked, returns first live or null (own pool)', () => {
  const proxies = [{ host: 'a', port: 1 }, { host: 'b', port: 2 }, { host: 'c', port: 3 }];
  const now = 1000;
  // a,b dead (expiry in the future) → c is the first live one
  assert.equal(nextLiveProxy(proxies, { 'a:1': now + 100, 'b:2': now + 100 }, now).host, 'c');
  // b's dead mark expired → b is live again
  assert.equal(nextLiveProxy(proxies, { 'a:1': now + 100, 'b:2': now - 1 }, now).host, 'b');
  // all dead → null
  assert.equal(nextLiveProxy(proxies, { 'a:1': now + 1, 'b:2': now + 1, 'c:3': now + 1 }, now), null);
  assert.equal(nextLiveProxy([], {}, now), null);
});

import {
  makeProxy, parseProxifly, parseProxyscrape, parseMonosans, parseHideip, parseTxt,
} from '../extension/lib/free-pool.js';

test('makeProxy: валидная socks5 запись → httpsCapable=true', () => {
  const p = makeProxy({ host: '1.2.3.4', port: 1080, protocol: 'socks5', country: 'NL' });
  assert.deepEqual(p, { host: '1.2.3.4', port: 1080, protocol: 'socks5', country: 'NL', score: 0, anonymity: null, httpsCapable: true });
});

test('makeProxy: http без https-флага → httpsCapable=false', () => {
  assert.equal(makeProxy({ host: '1.2.3.4', port: 80, protocol: 'http' }).httpsCapable, false);
});

test('makeProxy: http с https=true → httpsCapable=true', () => {
  assert.equal(makeProxy({ host: '1.2.3.4', port: 80, protocol: 'http', https: true }).httpsCapable, true);
});

test('makeProxy: невалидный порт/хост/протокол → null', () => {
  assert.equal(makeProxy({ host: '1.2.3.4', port: 99999, protocol: 'http' }), null);
  assert.equal(makeProxy({ host: '', port: 80, protocol: 'http' }), null);
  assert.equal(makeProxy({ host: '1.2.3.4', port: 80, protocol: 'foobar' }), null);
});

test('parseProxifly: JSON array', () => {
  const pool = parseProxifly(JSON.stringify(SAMPLE_POOL));
  assert.equal(pool.length, 3);
  assert.equal(pool[0].host, '1.2.3.4');
  assert.equal(pool[0].country, 'NL');
  assert.equal(pool[0].score, 100);
  assert.equal(pool[0].anonymity, 'elite');
});

test('parseProxifly: NDJSON', () => {
  const ndjson = SAMPLE_POOL.map((e) => JSON.stringify(e)).join('\n');
  assert.equal(parseProxifly(ndjson).length, 3);
});

test('parseProxifly: отбрасывает без ip/port, невалидный порт, неизвестный протокол', () => {
  const data = [
    { protocol: 'http', port: 80, geolocation: { country: 'US' } },
    { protocol: 'http', ip: '1.2.3.4', geolocation: { country: 'US' } },
    { protocol: 'http', ip: '1.2.3.4', port: 99999, geolocation: { country: 'US' } },
    { protocol: 'foobar', ip: '1.2.3.4', port: 80, geolocation: { country: 'US' } },
    { protocol: 'http', ip: '1.2.3.4', port: 8080, geolocation: { country: 'US' } },
  ];
  const pool = parseProxifly(JSON.stringify(data));
  assert.equal(pool.length, 1);
  assert.equal(pool[0].host, '1.2.3.4');
});

test('parseProxyscrape: берёт country_code (ISO), ssl→httpsCapable, uptime_percent→score', () => {
  const data = [{ protocol: 'http', ip: '9.9.9.9', port: 8080, country: 'Germany', country_code: 'DE', anonymity: 'elite', ssl: true, uptime_percent: 88 }];
  const pool = parseProxyscrape(JSON.stringify(data));
  assert.equal(pool[0].country, 'DE');
  assert.equal(pool[0].httpsCapable, true);
  assert.equal(pool[0].score, 88);
});

test('parseMonosans: host + geolocation.country.iso_code, RU-запись остаётся (отсев — в filterPool)', () => {
  const data = [{ protocol: 'socks5', host: '147.45.146.97', port: 1080, geolocation: { country: { iso_code: 'RU' } } }];
  const pool = parseMonosans(JSON.stringify(data));
  assert.equal(pool[0].host, '147.45.146.97');
  assert.equal(pool[0].protocol, 'socks5');
  assert.equal(pool[0].country, 'RU');
  assert.equal(pool[0].anonymity, null);
});

test('parseHideip: ip:port:Name, блокируемое имя→ISO, прочее→null, proto из аргумента', () => {
  const text = '1.2.3.4:8080:United States\n9.9.9.9:1080:Russia\n5.5.5.5:3128:Guatemala';
  const pool = parseHideip(text, 'http');
  assert.equal(pool.length, 3);
  assert.equal(pool[0].country, null);
  assert.equal(pool[1].country, 'RU');
  assert.equal(pool[2].country, null);
  assert.equal(pool[0].protocol, 'http');
});

test('parseTxt: чистый ip:port, proto из аргумента, country null', () => {
  const pool = parseTxt('31.131.248.51:3129\n46.62.214.3:1080\nгрязь\n', 'socks5');
  assert.equal(pool.length, 2);
  assert.equal(pool[0].host, '31.131.248.51');
  assert.equal(pool[0].protocol, 'socks5');
  assert.equal(pool[0].country, null);
});

test('parseProxyscrape: разворачивает обёртку {proxies:[...]}', () => {
  const wrapped = JSON.stringify({ proxies: [{ protocol: 'socks5', ip: '8.8.8.8', port: 1080, country_code: 'US' }] });
  const pool = parseProxyscrape(wrapped);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].host, '8.8.8.8');
  assert.equal(pool[0].country, 'US');
});

test('makeProxy: host из пробелов → null', () => {
  assert.equal(makeProxy({ host: '   ', port: 80, protocol: 'http' }), null);
});

test('parseTxt: стрипает inline-комментарий и пустые строки', () => {
  const pool = parseTxt('1.2.3.4:8080 # fast\n\n9.9.9.9:1080\n', 'http');
  assert.equal(pool.length, 2);
  assert.equal(pool[0].port, 8080);
});

import { dedupePool } from '../extension/lib/free-pool.js';

test('dedupePool: дубль protocol:host:port сливается (max score, OR httpsCapable, первое непустое country)', () => {
  const merged = dedupePool([
    { host: '1.1.1.1', port: 80, protocol: 'http', country: null, score: 10, anonymity: null, httpsCapable: false },
    { host: '1.1.1.1', port: 80, protocol: 'http', country: 'NL', score: 50, anonymity: 'elite', httpsCapable: true },
    { host: '2.2.2.2', port: 1080, protocol: 'socks5', country: 'US', score: 0, anonymity: null, httpsCapable: true },
  ]);
  assert.equal(merged.length, 2);
  const first = merged.find((p) => p.host === '1.1.1.1');
  assert.equal(first.score, 50);
  assert.equal(first.httpsCapable, true);
  assert.equal(first.country, 'NL');
  assert.equal(first.anonymity, 'elite');
});

test('dedupePool: разные протоколы на одном host:port — это разные записи', () => {
  const merged = dedupePool([
    { host: '1.1.1.1', port: 80, protocol: 'http', country: null, score: 0, anonymity: null, httpsCapable: false },
    { host: '1.1.1.1', port: 80, protocol: 'socks5', country: null, score: 0, anonymity: null, httpsCapable: true },
  ]);
  assert.equal(merged.length, 2);
});

test('parseProxifly: битый JSON-массив → пусто, не throw', () => {
  assert.deepEqual(parseProxifly('[{bad json'), []);
});
