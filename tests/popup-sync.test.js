// Синхронизация попапа с реальным состоянием (техника — как popup-reset.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const js = readFileSync(join(here, '..', 'extension', 'popup', 'popup.js'), 'utf8');

// Регрессия: вкладка источника переключается оптимистично ДО ответа фона; если
// фон упал не сохранив state, попап обязан перечитать storage — иначе UI
// показывает источник, который на самом деле не выбран.
test('SWITCH_SOURCE: при ошибке фона попап ресинхронизируется через loadState()', () => {
  const m = js.match(/#source-pills[\s\S]*?\n {4}\}\);/);
  assert.ok(m, 'обработчик source-pills найден');
  const resyncs = m[0].match(/state = await loadState\(\)/g) || [];
  assert.ok(resyncs.length >= 2, `ресинк и в else-ветке, и в catch (найдено ${resyncs.length})`);
});

// Регрессия: фон может ротировать прокси / применить RKN-чек при открытом попапе —
// главный экран обязан перерисоваться (настройки намеренно не трогаем: там формы).
test('storage.onChanged: видимый главный экран перерисовывается renderMain()', () => {
  const m = js.match(/chrome\.storage\.onChanged\.addListener\([\s\S]*?\n\}\);/);
  assert.ok(m, 'onChanged-листенер найден');
  assert.ok(/screen-main'\)\.hidden\) renderMain\(\)/.test(m[0]),
    'renderMain вызывается при видимом главном экране');
});
