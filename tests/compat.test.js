import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

beforeEach(() => { delete globalThis.browser; delete globalThis.chrome; });

test('compat: в Firefox (есть browser) chrome становится browser', async () => {
  const fakeBrowser = { runtime: {}, _ff: true };
  globalThis.browser = fakeBrowser;
  globalThis.chrome = { _callbackStyle: true };
  await import(`../extension/lib/compat.js?ff=${Date.now()}`);
  assert.equal(globalThis.chrome, fakeBrowser);
});

test('compat: в Chrome (нет browser) chrome не трогается', async () => {
  const fakeChrome = { runtime: {}, _chrome: true };
  globalThis.chrome = fakeChrome;
  await import(`../extension/lib/compat.js?ch=${Date.now()}`);
  assert.equal(globalThis.chrome, fakeChrome);
  assert.equal(globalThis.browser, undefined);
});
