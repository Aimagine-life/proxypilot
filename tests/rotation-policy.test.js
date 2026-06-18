import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerFailureAndDecide,
  FAILURE_WINDOW_MS,
  FAILURES_BEFORE_ROTATE,
} from '../extension/lib/rotation-policy.js';

test('rotation-policy: a single failure does not trigger rotation', () => {
  const failures = {};
  assert.equal(registerFailureAndDecide(failures, 'h:1', 1000), false);
});

test('rotation-policy: reaching the threshold within the window triggers rotation', () => {
  const failures = {};
  let decision;
  for (let i = 0; i < FAILURES_BEFORE_ROTATE; i++) {
    decision = registerFailureAndDecide(failures, 'h:1', 1000 + i);
  }
  assert.equal(decision, true);
});

test('rotation-policy: stays under threshold → no rotation', () => {
  const failures = {};
  let decision = false;
  for (let i = 0; i < FAILURES_BEFORE_ROTATE - 1; i++) {
    decision = registerFailureAndDecide(failures, 'h:1', 1000 + i);
  }
  assert.equal(decision, false);
});

test('rotation-policy: failures older than the window do not count', () => {
  const failures = {};
  // One ancient failure, then a fresh one far in the future → window dropped the old one.
  registerFailureAndDecide(failures, 'h:1', 1000);
  const decision = registerFailureAndDecide(failures, 'h:1', 1000 + FAILURE_WINDOW_MS + 1);
  assert.equal(decision, false); // only the fresh failure remains
  assert.equal(failures['h:1'].length, 1);
});

test('rotation-policy: counter resets after a rotation decision', () => {
  const failures = {};
  for (let i = 0; i < FAILURES_BEFORE_ROTATE; i++) {
    registerFailureAndDecide(failures, 'h:1', 1000 + i); // last call returns true
  }
  // After rotating, the very next failure should start a fresh count → false.
  assert.equal(registerFailureAndDecide(failures, 'h:1', 2000), false);
});

test('rotation-policy: switching to a different proxy clears the old proxy counters', () => {
  const failures = {};
  registerFailureAndDecide(failures, 'old:1', 1000);
  registerFailureAndDecide(failures, 'new:2', 1100);
  assert.equal(failures['old:1'], undefined); // old counter dropped when active proxy changed
  assert.ok(failures['new:2']);
});
