// "Reset presets" is an explicit user choice, so it must clear the RKN
// auto-disabled marks — otherwise the periodic RKN check would later re-enable a
// preset the user just reset (same class of bug as the togglePreset path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const js = readFileSync(join(here, '..', 'extension', 'popup', 'popup.js'), 'utf8');

test('popup reset: reset-presets handler clears rknAutoDisabled', () => {
  const m = js.match(/#reset-presets'\)\.addEventListener\([\s\S]*?\n {2}\}\);/);
  assert.ok(m, 'reset-presets handler found');
  assert.ok(/rknAutoDisabled\s*=\s*\{\}/.test(m[0]), 'handler must reset rknAutoDisabled');
});
