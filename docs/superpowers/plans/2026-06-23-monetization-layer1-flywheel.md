# Монетизация Слой 1 — маховик «плагин → канал» (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разметить исходящие ссылки попапа на ресурсы Wildbots UTM-метками и добавить ссылку «Гайды на YouTube» на экран «О разработчике», чтобы переходы из плагина стали измеримы в GA4 и замкнулся маховик «плагин → YouTube-канал».

**Architecture:** Чисто клиентское изменение статической разметки. Внутри расширения НЕ добавляется аналитика — UTM-параметры это пассивные метки в `href`, которые считывает GA4 на стороне сайта при переходе. Локализация подписи новой ссылки идёт через существующий механизм `data-i18n` + `messages.json` (RU/EN), JS не меняется. Корректность гарантируется новым unit-тестом, читающим `popup.html` и проверяющим UTM на каждой ссылке воронки.

**Tech Stack:** Manifest V3, vanilla JS (ESM), без сборки и зависимостей. Тесты — встроенный `node --test` (`node:test` + `node:assert/strict`). i18n — `chrome.i18n` через тонкую обёртку `extension/lib/i18n.js`.

## Global Constraints

- **Платформа:** Manifest V3, `minimum_chrome_version` 120, Chrome + Firefox. Vanilla JS, без сборки, без зависимостей (нельзя добавлять jsdom/cheerio и любые npm-пакеты).
- **Тесты:** запуск `npm test` → `node --test`; ESM; импорт `test` из `node:test`, `assert` из `node:assert/strict`; чтение файлов через `node:fs` + `fileURLToPath(import.meta.url)`. Новый тест-файл подхватывается по маске `tests/*.test.js` автоматически.
- **UTM-схема (единая, закреплена в тесте):** `utm_source=proxypilot`, `utm_medium=extension`, `utm_campaign` ∈ { `popup-footer`, `popup-about`, `popup-youtube` }.
- **В `href` амперсанд пишется как `&amp;`** (валидный HTML); тест нормализует `&amp;`→`&` перед `new URL()`.
- **Простота UI неприкосновенна:** новых элементов на `#screen-main` НЕ добавлять. Новая ссылка — только на экране «О разработчике» (`#screen-about`). Футер-ссылка уже существует — ей лишь добавляются UTM.
- **Без слежки:** никакой аналитики/телеметрии/новых permission внутри расширения. `manifest.json` permissions и privacy-policy НЕ меняются.
- **Юр-чистота:** тексты нейтральные, без формулировок про «обход блокировок». YouTube — бренд (в `description` ключа это отмечается).
- **i18n-паритет:** любой новый ключ добавляется СРАЗУ в `_locales/ru/messages.json` и `_locales/en/messages.json` (иначе упадёт `tests/locales.test.js`).
- **Бамп версии (правило проекта):** после правок — `0.16.0` → `0.16.1` в `extension/manifest.json` и `package.json`, запись в `CHANGELOG.md` (RU + EN-формулировка для стора).
- **PRE-REQ (подстановка перед стартом):** реальный URL YouTube-канала Wildbots. Во всех шагах ниже он обозначен как `YT_CHANNEL_URL` — заменить на фактический URL (например `https://www.youtube.com/@<канал>`). Хост обязан быть `youtube.com`/`youtu.be`, иначе тест не зачтёт ссылку как ссылку воронки.
- **Git:** коммиты conventional (`feat:`/`chore:`); файлы в `git add` перечислять явно по имени (не `-A`); НЕ добавлять trailer `Co-Authored-By: Claude` (правило пользователя).

---

### Task 1: UTM-разметка существующих ссылок на wildbots.ru + сторож-тест

**Files:**
- Create: `tests/popup-utm.test.js`
- Modify: `extension/popup/popup.html:72` (футер главного экрана), `extension/popup/popup.html:239` (ссылка «🌐 Сайт» на about)

**Interfaces:**
- Consumes: ничего (первая задача).
- Produces: тест-файл `tests/popup-utm.test.js` с функциями-хелперами `extractHrefs(src)` и `isFunnelLink(href)` и двумя тестами; UTM-схему `utm_source=proxypilot&utm_medium=extension&utm_campaign=<…>`, на которую опирается Task 2.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/popup-utm.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const popupPath = join(here, '..', 'extension', 'popup', 'popup.html');
const html = readFileSync(popupPath, 'utf8');

// Достаём все href из разметки и нормализуем HTML-сущность &amp; → &,
// чтобы new URL() корректно разобрал query-параметры.
function extractHrefs(src) {
  const hrefs = [];
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    hrefs.push(m[1].replace(/&amp;/g, '&'));
  }
  return hrefs;
}

// Ссылки воронки Wildbots: сайт и YouTube-канал. Telegram/GitHub/donate — НЕ воронка.
function isFunnelLink(href) {
  let u;
  try { u = new URL(href); } catch { return false; }
  const host = u.hostname.replace(/^www\./, '');
  return host === 'wildbots.ru' || host === 'youtube.com' || host === 'youtu.be';
}

test('popup utm: ссылки воронки присутствуют в popup.html', () => {
  const funnel = extractHrefs(html).filter(isFunnelLink);
  assert.ok(funnel.length > 0, 'ожидались ссылки на wildbots.ru/YouTube');
});

test('popup utm: каждая ссылка воронки размечена единой UTM-схемой', () => {
  const funnel = extractHrefs(html).filter(isFunnelLink);
  for (const href of funnel) {
    const u = new URL(href);
    assert.equal(u.searchParams.get('utm_source'), 'proxypilot', `utm_source у ${href}`);
    assert.equal(u.searchParams.get('utm_medium'), 'extension', `utm_medium у ${href}`);
    assert.ok(u.searchParams.get('utm_campaign'), `непустой utm_campaign у ${href}`);
  }
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node --test tests/popup-utm.test.js`
Expected: FAIL на втором тесте — текущие `https://wildbots.ru/` без UTM (`utm_source` === null). Первый тест проходит (ссылки на wildbots.ru уже есть).

- [ ] **Step 3: Разметить ссылку футера (popup.html:72)**

Было:
```html
<a class="app-footer-link" href="https://wildbots.ru/" target="_blank" rel="noopener noreferrer">Wildbots ↗</a>
```
Стало:
```html
<a class="app-footer-link" href="https://wildbots.ru/?utm_source=proxypilot&amp;utm_medium=extension&amp;utm_campaign=popup-footer" target="_blank" rel="noopener noreferrer">Wildbots ↗</a>
```

- [ ] **Step 4: Разметить ссылку «🌐 Сайт» на about (popup.html:239)**

Было:
```html
<a class="about-link" href="https://wildbots.ru/" target="_blank" rel="noopener noreferrer"><span class="about-link-ico">🌐</span> <span data-i18n="about_link_site">Сайт</span></a>
```
Стало:
```html
<a class="about-link" href="https://wildbots.ru/?utm_source=proxypilot&amp;utm_medium=extension&amp;utm_campaign=popup-about" target="_blank" rel="noopener noreferrer"><span class="about-link-ico">🌐</span> <span data-i18n="about_link_site">Сайт</span></a>
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `node --test tests/popup-utm.test.js`
Expected: PASS (оба теста; обе wildbots.ru-ссылки теперь с UTM).

- [ ] **Step 6: Прогнать весь набор тестов (регрессия)**

Run: `npm test`
Expected: PASS, все файлы (новый popup-utm + существующие не сломаны).

- [ ] **Step 7: Commit**

```bash
git add tests/popup-utm.test.js extension/popup/popup.html
git commit -m "feat(analytics): tag wildbots.ru popup links with UTM + guard test"
```

---

### Task 2: Ссылка «Гайды на YouTube» на экране «О разработчике»

**Files:**
- Modify: `extension/popup/popup.html` (вставка после строки 239, внутри блока `.about-links`)
- Modify: `extension/_locales/ru/messages.json` (после блока `about_link_site`)
- Modify: `extension/_locales/en/messages.json` (после блока `about_link_site`)
- Test: `tests/popup-utm.test.js` (уже учитывает YouTube через `isFunnelLink`), `tests/locales.test.js` (паритет ключей)

**Interfaces:**
- Consumes: из Task 1 — UTM-схема и тест `popup-utm.test.js` (его `isFunnelLink` уже включает `youtube.com`/`youtu.be`, поэтому новая ссылка автоматически попадает под проверку UTM).
- Produces: i18n-ключ `about_link_youtube` (есть в обеих локалях); новый `<a class="about-link">` на YouTube с UTM `utm_campaign=popup-youtube`.

- [ ] **Step 1: Убедиться, что тест ловит отсутствие/некорректность YouTube-ссылки (red)**

Сначала добавить ссылку БЕЗ UTM, чтобы увидеть, что сторож-тест её ловит. В `extension/popup/popup.html` сразу после строки 239 (ссылка «🌐 Сайт») и перед строкой 240 (Telegram) вставить временно:
```html
<a class="about-link" href="YT_CHANNEL_URL" target="_blank" rel="noopener noreferrer"><span class="about-link-ico">▶</span> <span data-i18n="about_link_youtube">Гайды на YouTube</span></a>
```

Run: `node --test tests/popup-utm.test.js`
Expected: FAIL — у YouTube-ссылки нет `utm_source` (тест `каждая ссылка воронки размечена…` падает).

- [ ] **Step 2: Добавить UTM к YouTube-ссылке (green)**

Заменить `href` вставленной ссылки на размеченный (подставить реальный `YT_CHANNEL_URL`; разделитель параметров — `&amp;`; если у канала уже есть свой query, добавить UTM через `&amp;`):
```html
<a class="about-link" href="YT_CHANNEL_URL?utm_source=proxypilot&amp;utm_medium=extension&amp;utm_campaign=popup-youtube" target="_blank" rel="noopener noreferrer"><span class="about-link-ico">▶</span> <span data-i18n="about_link_youtube">Гайды на YouTube</span></a>
```

Итоговый блок `.about-links` должен выглядеть так (порядок: Сайт → YouTube → Telegram → GitHub):
```html
<div class="about-links">
  <a class="about-link" href="https://wildbots.ru/?utm_source=proxypilot&amp;utm_medium=extension&amp;utm_campaign=popup-about" target="_blank" rel="noopener noreferrer"><span class="about-link-ico">🌐</span> <span data-i18n="about_link_site">Сайт</span></a>
  <a class="about-link" href="YT_CHANNEL_URL?utm_source=proxypilot&amp;utm_medium=extension&amp;utm_campaign=popup-youtube" target="_blank" rel="noopener noreferrer"><span class="about-link-ico">▶</span> <span data-i18n="about_link_youtube">Гайды на YouTube</span></a>
  <a class="about-link" href="https://t.me/romankov_k" target="_blank" rel="noopener noreferrer"><span class="about-link-ico">✈</span> Telegram</a>
  <a class="about-link" href="https://github.com/Aimagine-life" target="_blank" rel="noopener noreferrer"><span class="about-link-ico">⌨</span> GitHub</a>
</div>
```

Run: `node --test tests/popup-utm.test.js`
Expected: PASS.

- [ ] **Step 3: Добавить i18n-ключ в RU-локаль**

В `extension/_locales/ru/messages.json` сразу после блока `about_link_site` (он заканчивается на строке 379 закрывающей `},`) и перед `about_donate_cta` вставить:
```json
  "about_link_youtube": {
    "message": "Гайды на YouTube",
    "description": "Label for the YouTube guides link on the about screen. YouTube is a brand."
  },
```

- [ ] **Step 4: Добавить i18n-ключ в EN-локаль**

В `extension/_locales/en/messages.json` в той же позиции (после `about_link_site`, перед `about_donate_cta`) вставить:
```json
  "about_link_youtube": {
    "message": "Guides on YouTube",
    "description": "Label for the YouTube guides link on the about screen. YouTube is a brand."
  },
```

- [ ] **Step 5: Прогнать тесты (UTM + паритет локалей)**

Run: `npm test`
Expected: PASS — `popup-utm.test.js` зелёный (YouTube-ссылка с UTM), `locales.test.js` зелёный (ключ `about_link_youtube` есть в обеих локалях, JSON валиден).

- [ ] **Step 6: Commit**

```bash
git add extension/popup/popup.html extension/_locales/ru/messages.json extension/_locales/en/messages.json
git commit -m "feat(funnel): add YouTube guides link to About screen (RU/EN, UTM)"
```

---

### Task 3: Бамп версии, CHANGELOG и настройка GA4

**Files:**
- Modify: `extension/manifest.json:4` (`"version"`), `package.json:3` (`"version"`)
- Modify: `CHANGELOG.md` (новая секция сверху)
- Docs/manual: настройка GA4 (вне кода — чеклист)

**Interfaces:**
- Consumes: завершённые Task 1 и Task 2 (изменения, ради которых бампается версия).
- Produces: версия `0.16.1`; запись в CHANGELOG; настроенный в GA4 канал для `utm_source=proxypilot`.

- [ ] **Step 1: Бамп версии в манифесте**

`extension/manifest.json`: `"version": "0.16.0"` → `"version": "0.16.1"`.

- [ ] **Step 2: Бамп версии в package.json**

`package.json`: `"version": "0.16.0"` → `"version": "0.16.1"`.

- [ ] **Step 3: Запись в CHANGELOG.md**

Добавить новую секцию сразу под заголовком файла (перед `## [0.16.0]`):
```markdown
## [0.16.1] — 2026-06-23

### Добавлено
- **Ссылка «Гайды на YouTube» на экране «О разработчике».** Ведёт на YouTube-канал
  автора — из попапа можно сразу попасть к видео-гайдам.

### Изменено
- **Ссылки на сайт Wildbots размечены UTM-метками** (`utm_source=proxypilot`) для
  аналитики переходов на стороне сайта. Внутри расширения по-прежнему ничего не
  отслеживается — метки пассивные, живут только в URL ссылки.
```

EN-формулировка для store-листинга (при релизе; memory `feedback-store-multilang`):
```markdown
### Added
- "Guides on YouTube" link on the About screen → developer's YouTube channel.
### Changed
- Wildbots site links now carry UTM tags (utm_source=proxypilot) for site-side
  analytics. Nothing is tracked inside the extension — tags are passive URL params.
```

- [ ] **Step 4: Прогнать тесты (sanity)**

Run: `npm test`
Expected: PASS (бамп версии тесты не затрагивает; убедиться, что JSON манифеста валиден).

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json package.json CHANGELOG.md
git commit -m "chore(release): bump to 0.16.1 (UTM funnel + YouTube link)"
```

- [ ] **Step 6: Настройка GA4 (ручной шаг на стороне сайта, не в репозитории)**

Выполнить в аккаунте GA4 сайта `wildbots.ru`:
1. Admin → Data Display → Channel Groups → Create channel group. Условие: `Session source` exactly matches `proxypilot` → назвать канал «ProxyPilot Extension». (Альтернатива: условие по `Session medium` exactly matches `extension`.)
2. Admin → Data Streams → (поток) → Configure tag settings → List unwanted referrals: убедиться, что `wildbots.ru` НЕ в списке (иначе реферал будет игнорироваться).
3. После публикации релиза проверить: Reports → Acquisition → Traffic acquisition → Session source / medium → должно появиться `proxypilot / extension`. Для быстрой проверки — DebugView с открытием размеченной ссылки.

KPI Слоя 1 (зафиксировать как базовый отчёт): доля трафика `proxypilot / extension` (ранее скрыт в Direct) и разбивка по `utm_campaign` (`popup-footer` vs `popup-about` vs `popup-youtube`).

---

## Self-Review

**1. Spec coverage:**
- Спек, Компонент 1 (UTM-разметка исходящих ссылок) → Task 1 (wildbots.ru ×2) + Task 2 (YouTube). Telegram-@username исключён — UTM на личный username не работают (вывод аудита), не входит в воронку-цель. ✓
- Спек, Компонент 2 (ссылка возврата в контент на about) → Task 2. Главный экран не тронут — простота соблюдена. ✓
- Спек, Компонент 3 (измерение в GA4, без трекеров в плагине) → Task 3, Step 6. Внутри расширения аналитики нет. ✓
- Бамп версии + CHANGELOG RU/EN → Task 3. ✓
- Принципы (простота / без слежки / юр-чистота / i18n-паритет) → Global Constraints, применяются ко всем задачам. ✓

**2. Placeholder scan:** Единственная подстановка — `YT_CHANNEL_URL` (реальный параметр окружения, помечен в PRE-REQ, не логический плейсхолдер). Весь код тестов и точные правки приведены целиком. ✓

**3. Type consistency:** UTM-схема (`utm_source=proxypilot`, `utm_medium=extension`, `utm_campaign`∈{popup-footer,popup-about,popup-youtube}) едина в Task 1 и Task 2 и проверяется тестом. Ключ `about_link_youtube` одинаков в HTML и обеих локалях. Хелперы `extractHrefs`/`isFunnelLink` определены в Task 1 и переиспользуются. ✓
