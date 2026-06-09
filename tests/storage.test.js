import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mock chrome.storage.local for the duration of these tests.
let mockStore = {};
globalThis.chrome = {
  storage: {
    local: {
      get: (key) => Promise.resolve(key in mockStore ? { [key]: mockStore[key] } : {}),
      set: (obj) => { Object.assign(mockStore, obj); return Promise.resolve(); },
      clear: () => { mockStore = {}; return Promise.resolve(); },
    },
  },
};

const { loadState, saveState, getDefaultState } = await import('../extension/lib/storage.js');

test('getDefaultState: schemaVersion is 2', () => {
  assert.equal(getDefaultState().schemaVersion, 2);
});

test('getDefaultState: enabled is false', () => {
  assert.equal(getDefaultState().enabled, false);
});

test('getDefaultState: proxy is null', () => {
  assert.equal(getDefaultState().proxy, null);
});

test('getDefaultState: all presets disabled by default (neutral universal router)', () => {
  const s = getDefaultState();
  assert.equal(s.presets.gemini.enabled, false);
  assert.equal(s.presets.aiStudio.enabled, false);
  assert.equal(s.presets.googleAuth.enabled, false);
  assert.equal(s.presets.chatgpt.enabled, false);
});

test('loadState: returns default state when storage empty', async () => {
  await chrome.storage.local.clear();
  const s = await loadState();
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.enabled, false);
});

test('loadState/saveState: round-trip preserves data', async () => {
  await chrome.storage.local.clear();
  const original = getDefaultState();
  original.enabled = true;
  original.proxy = { host: '1.2.3.4', port: 1080, scheme: 'http', user: '', pass: '' };
  await saveState(original);
  const loaded = await loadState();
  assert.deepEqual(loaded, original);
});

test('getDefaultState: includes new v2 fields', () => {
  const s = getDefaultState();
  assert.equal(s.proxySource, 'manual');
  assert.equal(s.manualProxy, null);
  assert.deepEqual(s.freeProxy, {
    selected: null,
    lastError: null,
    deadHosts: {},
    poolFetchedAt: 0,
  });
});

test('loadState: fresh storage returns default v2', async () => {
  await chrome.storage.local.clear();
  const s = await loadState();
  assert.equal(s.proxySource, 'manual');
});

test('loadState: migrates v1 with proxy → v2 with manualProxy', async () => {
  await chrome.storage.local.clear();
  mockStore.state = {
    schemaVersion: 1,
    enabled: true,
    proxy: { host: '1.2.3.4', port: 8080, scheme: 'http', user: 'u', pass: 'p' },
    theme: 'auto',
    resolvedTheme: 'light',
    presets: {},
    customDomains: [],
  };
  const s = await loadState();
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.proxySource, 'manual');
  assert.deepEqual(s.manualProxy, { host: '1.2.3.4', port: 8080, scheme: 'http', user: 'u', pass: 'p' });
  assert.deepEqual(s.proxy, { host: '1.2.3.4', port: 8080, scheme: 'http', user: 'u', pass: 'p' });
  assert.equal(s.freeProxy.selected, null);
  assert.deepEqual(s.freeProxy.deadHosts, {});
});

test('loadState: migrates v1 with null proxy → manualProxy null', async () => {
  await chrome.storage.local.clear();
  mockStore.state = {
    schemaVersion: 1,
    enabled: false,
    proxy: null,
    theme: 'auto',
    resolvedTheme: 'light',
    presets: {},
    customDomains: [],
  };
  const s = await loadState();
  assert.equal(s.proxySource, 'manual');
  assert.equal(s.manualProxy, null);
  assert.equal(s.proxy, null);
});

test('loadState: v2 state is loaded as-is (idempotent)', async () => {
  await chrome.storage.local.clear();
  mockStore.state = {
    schemaVersion: 2,
    enabled: true,
    proxy: { host: '5.5.5.5', port: 1080, scheme: 'socks5' },
    proxySource: 'free',
    manualProxy: { host: '1.1.1.1', port: 80, scheme: 'http' },
    freeProxy: {
      selected: { host: '5.5.5.5', port: 1080, scheme: 'socks5', country: 'NL', latencyMs: 100, validatedAt: 123 },
      lastError: null,
      deadHosts: { '9.9.9.9:80': Date.now() + 60_000 },
      poolFetchedAt: Date.now(),
    },
    theme: 'auto',
    resolvedTheme: 'light',
    presets: {},
    customDomains: [],
  };
  const s = await loadState();
  assert.equal(s.proxySource, 'free');
  assert.equal(s.manualProxy.host, '1.1.1.1');
  assert.equal(s.freeProxy.selected.host, '5.5.5.5');
});

test('loadState: repeated calls on v1 state without saveState still return v2', async () => {
  await chrome.storage.local.clear();
  mockStore.state = {
    schemaVersion: 1,
    enabled: false,
    proxy: { host: '1.2.3.4', port: 8080, scheme: 'http', user: '', pass: '' },
    theme: 'auto',
    resolvedTheme: 'light',
    presets: {},
    customDomains: [],
  };
  // First load — runs migration in memory but does NOT call saveState
  const a = await loadState();
  assert.equal(a.schemaVersion, 2);
  assert.equal(a.proxySource, 'manual');
  // Second load — must still produce a valid v2 result
  const b = await loadState();
  assert.equal(b.schemaVersion, 2);
  assert.equal(b.proxySource, 'manual');
  assert.deepEqual(b.manualProxy, a.manualProxy);
});

test('loadState: v2 state with missing freeProxy gets backfilled', async () => {
  await chrome.storage.local.clear();
  mockStore.state = {
    schemaVersion: 2,
    enabled: false,
    proxy: null,
    proxySource: 'manual',
    manualProxy: null,
    // freeProxy intentionally absent (e.g., corrupted state)
    theme: 'auto',
    resolvedTheme: 'light',
    presets: {},
    customDomains: [],
  };
  const s = await loadState();
  assert.deepEqual(s.freeProxy, {
    selected: null,
    lastError: null,
    deadHosts: {},
    poolFetchedAt: 0,
  });
});

test('loadState: v2 state with missing freeProxy.deadHosts gets backfilled', async () => {
  await chrome.storage.local.clear();
  mockStore.state = {
    schemaVersion: 2,
    enabled: false,
    proxy: null,
    proxySource: 'manual',
    manualProxy: null,
    freeProxy: {
      selected: null,
      lastError: null,
      // deadHosts intentionally absent
      poolFetchedAt: 0,
    },
    theme: 'auto',
    resolvedTheme: 'light',
    presets: {},
    customDomains: [],
  };
  const s = await loadState();
  assert.deepEqual(s.freeProxy.deadHosts, {});
});
