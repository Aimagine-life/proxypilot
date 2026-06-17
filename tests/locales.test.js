// Locale completeness — guards against forgotten/mismatched translations and keeps
// adding a future language honest: every locale must have the same keys with the
// same $N placeholder arity as the default (en).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = join(here, '..', 'extension');

function loadLocale(lang) {
  return JSON.parse(readFileSync(join(extRoot, '_locales', lang, 'messages.json'), 'utf8'));
}

// Highest $N positional placeholder index referenced in a message (0 if none).
function placeholderArity(message) {
  const indices = [...String(message).matchAll(/\$(\d)/g)].map((m) => Number(m[1]));
  return indices.length ? Math.max(...indices) : 0;
}

const LOCALES = ['en', 'ru'];
const data = Object.fromEntries(LOCALES.map((l) => [l, loadLocale(l)]));
const en = data.en;

test('locales: every locale has the exact same key set as en', () => {
  const enKeys = Object.keys(en).sort();
  for (const lang of LOCALES) {
    if (lang === 'en') continue;
    const keys = Object.keys(data[lang]).sort();
    const missing = enKeys.filter((k) => !(k in data[lang]));
    const extra = keys.filter((k) => !(k in en));
    assert.deepEqual(missing, [], `${lang} is missing keys: ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `${lang} has unknown keys: ${extra.join(', ')}`);
  }
});

test('locales: every key has a non-empty message in every locale', () => {
  for (const lang of LOCALES) {
    for (const key of Object.keys(data[lang])) {
      assert.ok(
        typeof data[lang][key]?.message === 'string' && data[lang][key].message.length > 0,
        `${lang}.${key} has no message`,
      );
    }
  }
});

test('locales: placeholder arity matches en for every key', () => {
  for (const key of Object.keys(en)) {
    const enArity = placeholderArity(en[key].message);
    for (const lang of LOCALES) {
      if (lang === 'en') continue;
      const arity = placeholderArity(data[lang][key].message);
      assert.equal(arity, enArity, `placeholder arity differs for ${key} (${lang})`);
    }
  }
});

test('locales: every plural _one key has a matching _other in every locale', () => {
  for (const key of Object.keys(en)) {
    if (!key.endsWith('_one')) continue;
    const other = `${key.slice(0, -4)}_other`;
    for (const lang of LOCALES) {
      assert.ok(data[lang][other], `${lang}.${other} missing (pair for ${key})`);
    }
  }
});

test('locales: manifest __MSG__ keys exist in every locale and default_locale is set', () => {
  const manifest = JSON.parse(readFileSync(join(extRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.default_locale, 'en', 'manifest default_locale must be "en"');

  const referenced = new Set();
  for (const value of [manifest.name, manifest.description, manifest.action?.default_title]) {
    const m = typeof value === 'string' && value.match(/^__MSG_(.+)__$/);
    if (m) referenced.add(m[1]);
  }
  for (const key of referenced) {
    for (const lang of LOCALES) {
      assert.ok(data[lang][key], `${lang} missing manifest message key ${key}`);
    }
  }
});
