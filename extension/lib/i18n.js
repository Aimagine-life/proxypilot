// Thin i18n layer over the native WebExtensions chrome.i18n API (works in Chrome
// and, after lib/compat.js, in Firefox where chrome === browser). Import AFTER
// compat.js in every entry point.
//
// Adding a language = drop a new _locales/<lang>/messages.json. No code changes.
//
// Strings live in _locales/<lang>/messages.json. Static markup is localized
// declaratively via data-i18n* attributes + localizeDom(); dynamic strings call
// t() / plural() directly.

/** Resolve the browser UI language, e.g. 'en', 'ru', 'en-GB'. */
export function uiLang() {
  const g = globalThis;
  return (g.chrome?.i18n?.getUILanguage?.() || 'en');
}

function toSubs(subs) {
  if (subs == null) return undefined;
  return (Array.isArray(subs) ? subs : [subs]).map((v) => String(v));
}

/**
 * Translate a key. `subs` is a value or array of values for $1,$2,… placeholders.
 * Falls back to the key itself if the i18n API is unavailable (dev/tests) or the
 * key is missing — never throws, never returns empty for a real key.
 */
export function t(key, subs) {
  // Call getMessage on its receiver (not as an unbound reference) so it works
  // across engines, including Firefox's WebExtension polyfill.
  const i18n = globalThis.chrome?.i18n;
  if (i18n?.getMessage) {
    const msg = i18n.getMessage(key, toSubs(subs));
    if (msg) return msg;
  }
  return key;
}

// CLDR plural category for a count in the given language. Only the categories we
// actually key on matter; unknown categories fall back to 'other' in plural().
function pluralForm(n, lang) {
  const x = Math.abs(Number(n) || 0);
  if (String(lang).toLowerCase().startsWith('ru')) {
    const m10 = x % 10, m100 = x % 100;
    if (m10 === 1 && m100 !== 11) return 'one';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few';
    return 'many';
  }
  // Default (English-like): singular vs plural.
  return x === 1 ? 'one' : 'other';
}

/**
 * Plural-aware translate. Looks up `<baseKey>_<form>` (one|few|many|other) for the
 * count `n`, falling back to `<baseKey>_other` when that specific form isn't keyed.
 * `n` is passed as $1 unless explicit `subs` are given.
 */
export function plural(baseKey, n, subs) {
  const args = toSubs(subs == null ? n : subs);
  const form = pluralForm(n, uiLang());
  const i18n = globalThis.chrome?.i18n;
  if (i18n?.getMessage) {
    let msg = i18n.getMessage(`${baseKey}_${form}`, args);
    if (!msg && form !== 'other') msg = i18n.getMessage(`${baseKey}_other`, args);
    if (msg) return msg;
  }
  return `${baseKey}_${form}`;
}

/** Set <html lang> from the resolved UI language so the document advertises it. */
export function applyUiLang(doc = document) {
  if (doc?.documentElement) doc.documentElement.lang = uiLang();
}

/**
 * Localize static markup in one pass. Supported attributes:
 *   data-i18n             → textContent
 *   data-i18n-placeholder → placeholder attribute
 *   data-i18n-title       → title attribute
 *   data-i18n-alt         → alt attribute
 * Call once after the DOM is ready. Also sets <html lang>.
 */
export function localizeDom(root = document) {
  applyUiLang(root.ownerDocument || (root === document ? document : document));

  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  const attrs = [
    ['data-i18n-placeholder', 'i18nPlaceholder', 'placeholder'],
    ['data-i18n-title', 'i18nTitle', 'title'],
    ['data-i18n-alt', 'i18nAlt', 'alt'],
  ];
  for (const [selectorAttr, dsKey, domAttr] of attrs) {
    for (const el of root.querySelectorAll(`[${selectorAttr}]`)) {
      el.setAttribute(domAttr, t(el.dataset[dsKey]));
    }
  }
}
