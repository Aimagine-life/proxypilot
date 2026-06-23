// applyRknResults: the RKN check disables presets whose domains are in the
// registry, but must REMEMBER which ones it disabled (vs. the user) so it can
// restore them once a domain leaves the registry. Regression test for the
// YouTube case: domain dropped from the RKN list but the preset stayed off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRknResults } from '../extension/lib/rkn-check.js';

const YT = ['youtube.com', 'youtu.be'];
const blocked = { 'youtube.com': { blocked: true }, 'youtu.be': { blocked: true } };
const clear = { 'youtube.com': { blocked: false }, 'youtu.be': { blocked: false } };

test('applyRknResults: blocks an enabled preset and flags it auto-disabled', () => {
  const presets = { youtube: { domains: YT, enabled: true } };
  const { rknAutoDisabled, changed } = applyRknResults(presets, blocked, {});
  assert.equal(presets.youtube.enabled, false, 'preset disabled');
  assert.equal(rknAutoDisabled.youtube, true, 'flagged as RKN-disabled');
  assert.equal(changed, true);
});

test('applyRknResults: re-enables a preset WE auto-disabled once the domain leaves the registry', () => {
  const presets = { youtube: { domains: YT, enabled: false } };
  const { rknAutoDisabled, changed } = applyRknResults(presets, clear, { youtube: true });
  assert.equal(presets.youtube.enabled, true, 'preset restored');
  assert.equal(rknAutoDisabled.youtube, undefined, 'flag cleared');
  assert.equal(changed, true);
});

test('applyRknResults: does NOT re-enable a preset the user disabled', () => {
  const presets = { youtube: { domains: YT, enabled: false } };
  const { rknAutoDisabled, changed } = applyRknResults(presets, clear, {});
  assert.equal(presets.youtube.enabled, false, 'user choice respected');
  assert.equal(changed, false);
  assert.equal(rknAutoDisabled.youtube, undefined);
});

test('applyRknResults: blocked + already disabled is a no-op (not flagged auto)', () => {
  const presets = { youtube: { domains: YT, enabled: false } };
  const { rknAutoDisabled, changed } = applyRknResults(presets, blocked, {});
  assert.equal(presets.youtube.enabled, false);
  assert.equal(changed, false);
  assert.equal(rknAutoDisabled.youtube, undefined, 'not our doing — never flag');
});

test('applyRknResults: independent presets — only the blocked one is touched', () => {
  const presets = {
    youtube: { domains: YT, enabled: true },
    gemini: { domains: ['gemini.google.com'], enabled: true },
  };
  const results = { ...blocked, 'gemini.google.com': { blocked: false } };
  const { rknAutoDisabled } = applyRknResults(presets, results, {});
  assert.equal(presets.youtube.enabled, false);
  assert.equal(presets.gemini.enabled, true);
  assert.equal(rknAutoDisabled.youtube, true);
  assert.equal(rknAutoDisabled.gemini, undefined);
});
