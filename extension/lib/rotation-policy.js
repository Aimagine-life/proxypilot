// Pure policy for reactive proxy rotation. No chrome.* APIs — fully testable.
//
// Free proxies are slow on the FIRST connection to a new host: that connection
// often times out (a proxy-class error) even though the proxy is alive and a
// retry works. Rotating away on that first error is the bug behind "every new
// site hangs, then works after waiting" — rotation kicks off a costly pool scan.
//
// So: only rotate when a proxy fails repeatedly in a short window (a genuinely
// dead proxy keeps failing fast). A lone slow first connect is tolerated.

export const FAILURE_WINDOW_MS = 15_000;
export const FAILURES_BEFORE_ROTATE = 3;

/**
 * Record a proxy connection failure for `key` (`host:port`) at time `now` and
 * decide whether to rotate. Mutates `failures` in place ({ key: number[] }).
 *
 * Returns true once `key` has accumulated >= threshold failures within windowMs;
 * on a true result the key's counter is reset (so the next failure starts fresh).
 * Counters for any other key are dropped — the active proxy has changed.
 */
export function registerFailureAndDecide(
  failures,
  key,
  now,
  { windowMs = FAILURE_WINDOW_MS, threshold = FAILURES_BEFORE_ROTATE } = {},
) {
  for (const k of Object.keys(failures)) {
    if (k !== key) delete failures[k];
  }
  const recent = (failures[key] || []).filter((t) => now - t < windowMs);
  recent.push(now);
  failures[key] = recent;
  if (recent.length >= threshold) {
    delete failures[key];
    return true;
  }
  return false;
}
