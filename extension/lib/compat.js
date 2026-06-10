// Cross-browser namespace shim. Firefox exposes promise-based APIs on `browser`
// (its `chrome` is callback-only); Chrome MV3 has promise-based `chrome` and no
// `browser`. Reassigning chrome→browser in Firefox lets the rest of the codebase
// keep using `chrome.*` with promises in both browsers. No-op in Chrome.
// Import this FIRST in every entry point (background, popup).
if (typeof browser !== 'undefined' && browser && browser.runtime) {
  globalThis.chrome = browser;
}
