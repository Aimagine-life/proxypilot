// background.js — entry point с top-level chrome.* вызовами, поэтому проверяем
// исходник текстом (та же техника, что popup-reset.test.js / popup-rate.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const js = readFileSync(join(here, '..', 'extension', 'background.js'), 'utf8');

// Регрессия: при выключенном расширении наш PAC снят, и proxy-ошибки приходят от
// чужого (системного) прокси — ротация запустила бы скан пула и перехват
// chrome.proxy.settings, хотя пользователь нас выключил.
test('handleProxyError: guard state.enabled стоит до проверки proxySource', () => {
  const m = js.match(/async function handleProxyError\([\s\S]*?\n\}/);
  assert.ok(m, 'handleProxyError найден');
  const guardIdx = m[0].indexOf('if (!state.enabled) return;');
  const sourceIdx = m[0].indexOf("state.proxySource !== 'free'");
  assert.ok(guardIdx !== -1, 'guard state.enabled присутствует');
  assert.ok(sourceIdx !== -1, 'проверка proxySource присутствует');
  assert.ok(guardIdx < sourceIdx, 'guard раньше проверки источника');
});

// Регрессия: без .catch упавший runProxyTest никогда не вызовет sendResponse —
// попап не получит ответ и молча не покажет результат теста.
test('TEST_PROXY / TEST_SERVICE: async-ответ защищён .catch', () => {
  assert.match(js, /runProxyTest\('https:\/\/ipinfo\.io\/json'\)\s*\.then\(sendResponse\)\s*\.catch\(/,
    'TEST_PROXY отвечает и при исключении');
  assert.match(js, /runProxyTest\(`https:\/\/\$\{domain\}\/`\)\s*\.then\(sendResponse\)\s*\.catch\(/,
    'TEST_SERVICE отвечает и при исключении');
});

test('RKN_CHECK и DETECT_SCHEME: исключения не остаются необработанными', () => {
  const rkn = js.match(/msg\?\.type === 'RKN_CHECK'[\s\S]*?return true;/);
  assert.ok(rkn && /\.catch\(/.test(rkn[0]), 'RKN_CHECK имеет .catch');
  const detect = js.match(/msg\?\.type === 'DETECT_SCHEME'[\s\S]*?return false;/);
  assert.ok(detect && /\.catch\(/.test(detect[0]), 'DETECT_SCHEME имеет .catch');
});
