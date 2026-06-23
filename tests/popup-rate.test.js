// Guards the "Rate the extension" button on the about screen: it must be an
// active control (not the old coming-soon placeholder) and link to BOTH stores'
// review pages so neither browser is left pointing nowhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, '..', 'extension');
const html = readFileSync(join(ext, 'popup', 'popup.html'), 'utf8');
const js = readFileSync(join(ext, 'popup', 'popup.js'), 'utf8');

test('popup rate: about-rate is an active button, not the coming-soon placeholder', () => {
  assert.ok(html.includes('id="about-rate"'), 'about-rate element exists');
  assert.ok(html.includes('about-cta-rate'), 'uses the active about-cta-rate class');
  assert.ok(!html.includes('about-cta-soon'), 'coming-soon placeholder is gone');
});

test('popup rate: button links to both stores’ review pages', () => {
  assert.ok(
    js.includes('chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj/reviews'),
    'Chrome Web Store reviews URL present',
  );
  assert.ok(
    js.includes('addons.mozilla.org/firefox/addon/proxypilot/reviews'),
    'Firefox AMO reviews URL present',
  );
});
