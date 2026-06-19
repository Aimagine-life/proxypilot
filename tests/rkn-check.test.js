import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDomain } from '../extension/lib/rkn-check.js';

// The always-blocked set is resolved before any network/storage access, so these
// assertions run offline and deterministically.

test('checkDomain: blocks youtube.com (always-blocked)', async () => {
  const r = await checkDomain('youtube.com');
  assert.equal(r.blocked, true);
});

test('checkDomain: blocks youtube subdomains via suffix match', async () => {
  for (const d of ['www.youtube.com', 'm.youtube.com', 'music.youtube.com']) {
    assert.equal((await checkDomain(d)).blocked, true, `${d} should be blocked`);
  }
});

test('checkDomain: blocks youtube media/CDN/alias hosts', async () => {
  for (const d of ['youtu.be', 'googlevideo.com', 'ytimg.com', 'ggpht.com', 'youtube-nocookie.com']) {
    assert.equal((await checkDomain(d)).blocked, true, `${d} should be blocked`);
  }
});
