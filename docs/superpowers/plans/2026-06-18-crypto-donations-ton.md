# Крипто-донаты (TON) через экран «Поддержать» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить крипто-донаты (USDT/TON на один TON-адрес `@wallet`) как второй способ поддержки рядом с Yoomoney, через новый экран «Поддержать» в popup расширения.

**Architecture:** Новый экран `#screen-support` по паттерну `#screen-about`. Три существующие точки входа (баннер, footer, about) вместо прямой ссылки на Yoomoney открывают этот экран, внутри которого два способа: Карта/Yoomoney (внешняя ссылка) и Крипта (статичный QR-PNG + копируемый адрес). Новых зависимостей в рантайме нет — статичный PNG обходит CSP MV3.

**Tech Stack:** Vanilla JS (ES modules), Chrome Extension MV3, `_locales` i18n, `node --test` (только для локалей), CSS на существующих переменных.

## Global Constraints

- **Версия:** бамп `0.13.1` → `0.14.0` в `extension/manifest.json` И `package.json` (правило проекта: версию бампать до отчёта «готово»).
- **Локали:** каждый новый ключ обязан существовать в `en` И `ru` с непустым `message` (иначе падает `tests/locales.test.js`).
- **TON-адрес (единственный источник — текст в HTML):** `UQCBazZZbctu3IEMdPp5H8pKtQhf9raykndGUYo7hQsF5yGo`
- **Yoomoney-ссылка (без изменений):** `https://yoomoney.ru/to/410011076392857`
- **CSP:** MV3 дефолт (`script-src 'self'`) — никаких внешних скриптов/CDN, только локальный PNG и `<img>`.
- **Коммиты:** выполнять ТОЛЬКО по явной команде пользователя (правило проекта «коммит только когда просят»). Шаги `Commit` ниже — точки атомарного коммита; на исполнении дождаться разрешения.
- **DOM-автотестов в проекте нет** — навигация/копирование проверяются вручную в Chrome по шагам ниже. Не вводить jsdom/новые зависимости ради тестов.

---

### Task 1: Локализация — новые ключи RU+EN

**Files:**
- Modify: `extension/_locales/en/messages.json` (вставить после блока `main_donate_banner_close_title`, ~строка 51)
- Modify: `extension/_locales/ru/messages.json` (вставить в то же место)
- Test: `tests/locales.test.js` (уже существует — проверяет паритет ключей en↔ru)

**Interfaces:**
- Produces: ключи `support_title`, `support_intro`, `support_method_card_label`, `support_method_card_sub`, `support_card_btn`, `support_method_crypto_label`, `support_crypto_sub`, `support_copy`, `support_copied`, `support_crypto_note` — на них ссылаются `data-i18n` в Task 3 и `t()` в Task 4.

- [ ] **Step 1: Добавить ключи в EN-локаль**

В `extension/_locales/en/messages.json` после объекта `"main_donate_banner_close_title": { ... },` (строка ~51) вставить:

```json
  "support_title": {
    "message": "Support the project",
    "description": "Title of the support/donation screen."
  },
  "support_intro": {
    "message": "Thanks for using ProxyPilot. Your support helps keep the project going.",
    "description": "Intro line on the support screen."
  },
  "support_method_card_label": {
    "message": "Bank card (Russia)",
    "description": "Label of the bank-card support method."
  },
  "support_method_card_sub": {
    "message": "Russian cards via YooMoney",
    "description": "Subtitle clarifying the card method works with Russian cards."
  },
  "support_card_btn": {
    "message": "💳 Pay",
    "description": "Button opening the YooMoney payment page."
  },
  "support_method_crypto_label": {
    "message": "Cryptocurrency",
    "description": "Label of the crypto support method."
  },
  "support_crypto_sub": {
    "message": "USDT or TON · TON network",
    "description": "Subtitle under the crypto method describing accepted assets."
  },
  "support_copy": {
    "message": "Copy",
    "description": "Button that copies the TON address to clipboard."
  },
  "support_copied": {
    "message": "Copied ✓",
    "description": "Transient label shown after the address is copied."
  },
  "support_crypto_note": {
    "message": "Via Telegram → @wallet. I accept both USDT (TON) and TON.",
    "description": "Hint explaining how to send the crypto donation."
  },
```

- [ ] **Step 2: Запустить тест локалей — убедиться, что он ПАДАЕТ**

Run: `npm test -- tests/locales.test.js` (или `node --test tests/locales.test.js`)
Expected: FAIL — `ru is missing keys: support_card_btn, support_copied, support_copy, support_crypto_note, support_crypto_sub, support_intro, support_method_card_label, support_method_card_sub, support_method_crypto_label, support_title`

- [ ] **Step 3: Добавить те же ключи в RU-локаль**

В `extension/_locales/ru/messages.json` после `"main_donate_banner_close_title": { ... },` (строка ~51) вставить:

```json
  "support_title": {
    "message": "Поддержать проект",
    "description": "Title of the support/donation screen."
  },
  "support_intro": {
    "message": "Спасибо, что пользуешься ProxyPilot. Поддержка помогает развивать проект.",
    "description": "Intro line on the support screen."
  },
  "support_method_card_label": {
    "message": "Банковская карта",
    "description": "Label of the bank-card support method."
  },
  "support_method_card_sub": {
    "message": "Картой РФ через ЮMoney",
    "description": "Subtitle clarifying the card method works with Russian cards."
  },
  "support_card_btn": {
    "message": "💳 Перейти к оплате",
    "description": "Button opening the YooMoney payment page."
  },
  "support_method_crypto_label": {
    "message": "Криптовалюта",
    "description": "Label of the crypto support method."
  },
  "support_crypto_sub": {
    "message": "USDT или TON · сеть TON",
    "description": "Subtitle under the crypto method describing accepted assets."
  },
  "support_copy": {
    "message": "Копировать",
    "description": "Button that copies the TON address to clipboard."
  },
  "support_copied": {
    "message": "Скопировано ✓",
    "description": "Transient label shown after the address is copied."
  },
  "support_crypto_note": {
    "message": "Через Telegram → @wallet. Принимаю и USDT (TON), и TON.",
    "description": "Hint explaining how to send the crypto donation."
  },
```

- [ ] **Step 4: Запустить тест локалей — убедиться, что он ПРОХОДИТ**

Run: `npm test -- tests/locales.test.js`
Expected: PASS — все 5 тестов зелёные (паритет ключей, непустые message, arity, плюрали, manifest-ключи).

- [ ] **Step 5: Commit** (по разрешению пользователя)

```bash
git add extension/_locales/en/messages.json extension/_locales/ru/messages.json
git commit -m "feat(i18n): add support-screen strings (RU+EN)"
```

---

### Task 2: QR-PNG для TON-адреса

**Files:**
- Create: `extension/popup/qr-ton.png`

**Interfaces:**
- Produces: файл `extension/popup/qr-ton.png` — на него ссылается `<img src="qr-ton.png">` в Task 3.

- [ ] **Step 1: Сгенерировать QR из TON-адреса**

Основной путь (Node CLI пакета `qrcode`, разовый запуск через npx, без записи в зависимости):

Run:
```bash
npx --yes qrcode -o extension/popup/qr-ton.png -w 320 -m 2 "UQCBazZZbctu3IEMdPp5H8pKtQhf9raykndGUYo7hQsF5yGo"
```

Фолбэк, если `npx` недоступен, но есть `qrencode`:
```bash
qrencode -o extension/popup/qr-ton.png -s 8 -m 2 "UQCBazZZbctu3IEMdPp5H8pKtQhf9raykndGUYo7hQsF5yGo"
```

- [ ] **Step 2: Проверить, что файл создан и это валидный PNG**

Run: `file extension/popup/qr-ton.png`
Expected: `... PNG image data, 320 x 320` (или близкий размер) — не пустой, не 0 байт.

Дополнительно: открыть PNG, отсканировать телефоном (камера/Telegram) — должен распознаться ровно адрес `UQCBazZZbctu3IEMdPp5H8pKtQhf9raykndGUYo7hQsF5yGo`.

- [ ] **Step 3: Commit** (по разрешению пользователя)

```bash
git add extension/popup/qr-ton.png
git commit -m "feat(donate): add TON address QR image"
```

---

### Task 3: Разметка экрана «Поддержать» + стили

**Files:**
- Modify: `extension/popup/popup.html` (добавить `<section id="screen-support">` после `#screen-about`, перед закрывающим `</div>` контейнера `#app` — после строки 254)
- Modify: `extension/popup/popup.html` (точки входа: строки 44, 69, 245 — заменить `<a href="yoomoney…">` на кнопки)
- Modify: `extension/popup/popup.css` (добавить блок `.support-*` в конец файла; правки кнопочных точек входа)

**Interfaces:**
- Consumes: ключи локалей из Task 1; `extension/popup/qr-ton.png` из Task 2.
- Produces: элементы с id `screen-support`, `back-from-support`, `ton-address`, `support-copy`; точки входа с id `donate-banner-link`, `footer-donate`, `about-donate` — их слушатели вешает Task 4.

- [ ] **Step 1: Добавить разметку экрана support**

В `extension/popup/popup.html` после `</section>` экрана about (строка 254), перед `</div>` (строка 255) вставить:

```html
    <!-- Support / donate screen -->
    <section id="screen-support" class="screen" hidden>
      <header class="header">
        <button type="button" class="back" id="back-from-support" data-i18n-title="back" title="Назад">←</button>
        <div class="header-text"><div class="title" data-i18n="support_title">Поддержать проект</div></div>
      </header>

      <div class="support-body">
        <div class="support-intro">
          <span class="support-intro-icon">💛</span>
          <span data-i18n="support_intro">Спасибо, что пользуешься ProxyPilot. Поддержка помогает развивать проект.</span>
        </div>

        <section class="support-card">
          <div class="support-card-label" data-i18n="support_method_card_label">Банковская карта</div>
          <div class="support-card-sub" data-i18n="support_method_card_sub">Картой РФ через ЮMoney</div>
          <a class="support-card-btn" href="https://yoomoney.ru/to/410011076392857" target="_blank" rel="noopener noreferrer" data-i18n="support_card_btn">💳 Перейти к оплате</a>
        </section>

        <section class="support-card">
          <div class="support-card-label" data-i18n="support_method_crypto_label">Криптовалюта</div>
          <div class="support-card-sub" data-i18n="support_crypto_sub">USDT или TON · сеть TON</div>
          <div class="support-qr-wrap">
            <img class="support-qr" src="qr-ton.png" width="160" height="160" alt="TON QR" />
          </div>
          <div class="support-addr-row">
            <code class="support-addr" id="ton-address">UQCBazZZbctu3IEMdPp5H8pKtQhf9raykndGUYo7hQsF5yGo</code>
            <button type="button" class="support-copy" id="support-copy" data-i18n="support_copy">Копировать</button>
          </div>
          <div class="support-note" data-i18n="support_crypto_note">Через Telegram → @wallet. Принимаю и USDT (TON), и TON.</div>
        </section>
      </div>
    </section>
```

- [ ] **Step 2: Переключить три точки входа на кнопки**

В `extension/popup/popup.html`:

Строка 44 (баннер) — заменить `<a …>` на:
```html
        <button type="button" class="donate-banner-btn" id="donate-banner-link" data-i18n="main_donate_banner_btn">Поддержать</button>
```

Строка 69 (footer) — заменить `<a …>` на:
```html
        <button type="button" class="footer-donate" id="footer-donate" data-i18n="main_footer_donate">💛 Поддержать проект</button>
```

Строка 245 (about) — заменить `<a …>` на:
```html
        <button type="button" class="about-cta about-cta-primary" id="about-donate" data-i18n="about_donate_cta">💛 Поддержать проект</button>
```

- [ ] **Step 3: Добавить CSS экрана support и починить кнопочные точки входа**

В конец `extension/popup/popup.css` добавить:

```css
/* ── Support / donate screen ─────────────────────────────────────── */
.support-body { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
.support-intro {
  display: flex; gap: 8px; align-items: flex-start;
  font-size: 12px; line-height: 1.4; color: var(--amber-ink);
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.32);
  border-radius: 10px; padding: 10px 12px;
}
.support-intro-icon { flex: 0 0 auto; font-size: 14px; }
.support-card {
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: 12px; padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.support-card-label { font-size: 12.5px; font-weight: 700; color: var(--text); }
.support-card-sub { font-size: 11px; color: var(--text-mute); margin-top: -4px; }
.support-card-btn {
  display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 12px; border-radius: 10px;
  font-size: 12.5px; font-weight: 700; text-decoration: none;
  background: linear-gradient(135deg, var(--indigo), var(--cyan));
  color: #fff; box-shadow: 0 2px 10px rgba(99, 102, 241, 0.32);
  transition: transform 0.1s;
}
.support-card-btn:active { transform: translateY(1px); }
.support-qr-wrap { display: flex; justify-content: center; padding: 4px 0; }
.support-qr {
  width: 160px; height: 160px; border-radius: 8px;
  background: #fff; padding: 8px; border: 1px solid var(--border-strong);
}
.support-addr-row { display: flex; gap: 8px; align-items: stretch; }
.support-addr {
  flex: 1 1 auto; min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; line-height: 1.35; word-break: break-all;
  background: var(--bg-1); border: 1px solid var(--border-strong);
  border-radius: 8px; padding: 8px 10px; color: var(--text);
}
.support-copy {
  flex: 0 0 auto; align-self: flex-start;
  padding: 8px 12px; border-radius: 8px; border: 0; cursor: pointer;
  background: var(--amber); color: #fff; font-weight: 700; font-size: 11px;
}
.support-copy:hover { filter: brightness(1.08); }
.support-copy:active { transform: translateY(1px); }
.support-note { font-size: 11px; color: var(--text-mute); line-height: 1.4; }

/* Кнопочные точки входа в донат (были <a>, стали <button>) */
.donate-banner-btn { border: 0; cursor: pointer; }
.footer-donate { border: 1px solid rgba(245, 158, 11, 0.32); cursor: pointer; font: inherit; }
button.about-cta { border: 0; cursor: pointer; width: 100%; font: inherit; }
```

Примечание: если `--bg-1`/`--text` не объявлены в `:root`, заменить на ближайшие существующие (`--bg-2`, `--amber-ink`). Проверить имена переменных в начале `popup.css` перед запуском.

- [ ] **Step 4: Ручная проверка вёрстки (временно показать экран)**

Временно убрать `hidden` у `#screen-support`, загрузить расширение распакованным (`chrome://extensions` → Load unpacked → папка `extension`), открыть popup.

Expected: видны заголовок «Поддержать проект» с кнопкой «←», интро-плашка, две карточки (Карта и Крипта), QR-картинка не битая, адрес моноширинный с переносом, кнопка «Копировать». Проверить в light и dark теме (переключатель темы в настройках). Вернуть `hidden` обратно.

- [ ] **Step 5: Commit** (по разрешению пользователя)

```bash
git add extension/popup/popup.html extension/popup/popup.css
git commit -m "feat(donate): add support screen markup and styles"
```

---

### Task 4: Навигация и копирование адреса

**Files:**
- Modify: `extension/popup/popup.js:102` (массив `screens` → добавить `'support'`)
- Modify: `extension/popup/popup.js:124-150` (скрывать `#screen-support` в `showMain`/`showSettings`/`showAbout`; добавить `showSupport()`)
- Modify: `extension/popup/popup.js:298-314` (слушатели точек входа + back + copy внутри `bindMain()`)

**Interfaces:**
- Consumes: id-элементы из Task 3 (`screen-support`, `back-from-support`, `ton-address`, `support-copy`, `donate-banner-link`, `footer-donate`, `about-donate`); ключи `support_copy`/`support_copied` из Task 1; существующие хелперы `$`, `t`, `animateScreen`, `persist`, `renderMain`, флаг `donateBannerDue`, `state.donate`.
- Produces: функция `showSupport()`.

- [ ] **Step 1: Добавить 'support' в массив экранов**

В `extension/popup/popup.js` строка 102 заменить:
```js
  const screens = ['main', 'settings', 'firstrun', 'about'];
```
на:
```js
  const screens = ['main', 'settings', 'firstrun', 'about', 'support'];
```

- [ ] **Step 2: Скрывать support в остальных экранах + добавить showSupport()**

В `showMain` (после строки 128 `$('#screen-about').hidden = true;`) добавить строку:
```js
  $('#screen-support').hidden = true;
```
То же добавить в `showSettings` (после строки 137) и в `showAbout` (после строки 146).

После функции `showAbout` (после строки 150) добавить:
```js
function showSupport() {
  $('#screen-main').hidden = true;
  $('#screen-settings').hidden = true;
  $('#screen-firstrun').hidden = true;
  $('#screen-about').hidden = true;
  $('#screen-support').hidden = false;
  animateScreen($('#screen-support'), 'forward');
}
```

- [ ] **Step 3: Переписать слушатели точек входа + back + copy**

В `bindMain()` заменить блок строк 302-314 (слушатели `donate-banner-close` и `donate-banner-link`) на:

```js
  $('#donate-banner-close').addEventListener('click', async () => {
    state.donate.dismissed = true;
    donateBannerDue = false;
    await persist();
    renderMain();
  });
  // Клик по «Поддержать» в баннере: пользователь отреагировал — баннер больше
  // не нужен (постоянная кнопка в футере остаётся), открываем экран поддержки.
  $('#donate-banner-link').addEventListener('click', () => {
    state.donate.dismissed = true;
    donateBannerDue = false;
    persist();
    showSupport();
  });
  $('#footer-donate').addEventListener('click', () => showSupport());
  $('#about-donate').addEventListener('click', () => showSupport());
  $('#back-from-support').addEventListener('click', () => showMain());
  $('#support-copy').addEventListener('click', async () => {
    const addr = $('#ton-address').textContent.trim();
    try {
      await navigator.clipboard.writeText(addr);
    } catch {
      // Буфер недоступен (редко в popup) — молча игнорируем, адрес виден и копируется вручную.
    }
    const btn = $('#support-copy');
    btn.textContent = t('support_copied');
    setTimeout(() => { btn.textContent = t('support_copy'); }, 1500);
  });
```

Примечание: `#about-donate` находится на экране about, но его слушатель вешается в `bindMain()` один раз при старте — элемент уже в DOM, это корректно (как и текущий код).

- [ ] **Step 4: Ручная проверка навигации и копирования**

Загрузить расширение распакованным, прогнать:

Expected:
1. Footer «💛 Поддержать проект» → открывается экран support (анимация forward).
2. «← Назад» → возврат на main.
3. About → «💛 Поддержать проект» → экран support.
4. Кнопка «Копировать» → в буфере `UQCBazZZbctu3IEMdPp5H8pKtQhf9raykndGUYo7hQsF5yGo` (вставить в любое поле и сверить); подпись на ~1.5 c меняется на «Скопировано ✓», затем возвращается.
5. «Карта / Перейти к оплате» → открывает Yoomoney в новой вкладке.
6. Баннер (если показан) «Поддержать» → открывает support и больше не появляется (`dismissed`).
7. Открыть settings и about, затем main — `#screen-support` нигде не «протекает» (не виден поверх).

- [ ] **Step 5: Commit** (по разрешению пользователя)

```bash
git add extension/popup/popup.js
git commit -m "feat(donate): wire support screen navigation and address copy"
```

---

### Task 5: Бамп версии и changelog

**Files:**
- Modify: `extension/manifest.json:4` (`version`)
- Modify: `package.json:3` (`version`)
- Modify: `CHANGELOG.md` (новая запись в начале, после строки 5)

**Interfaces:**
- Consumes: всё предыдущее (фича целиком).

- [ ] **Step 1: Бамп версии в manifest и package**

`extension/manifest.json` строка 4: `"version": "0.13.1",` → `"version": "0.14.0",`
`package.json` строка 3: `"version": "0.13.1",` → `"version": "0.14.0",`

- [ ] **Step 2: Добавить запись в CHANGELOG.md**

В `CHANGELOG.md` после строки 5 (перед `## [0.12.0]`) вставить (формат файла — русский, как все записи):

```markdown
## [0.14.0] — 2026-06-18

### Добавлено
- **Крипто-донаты (TON).** Новый экран «Поддержать» с двумя способами: карта
  через ЮMoney и криптовалюта. Принимаются **USDT и TON в сети TON** на один
  адрес кошелька Telegram (`@wallet`): QR-код, копируемый адрес и подсказка.
  Международной аудитории (после перевода на EN) — удобный способ поддержать
  проект без российской карты.
  - Все три точки входа (баннер, футер, «О разработчике») теперь ведут на экран
    «Поддержать», а не сразу на ЮMoney.

```

- [ ] **Step 3: Store-changelog для Chrome Web Store (RU + EN)**

Сохранить как артефакт для вставки в листинг при публикации (правило проекта — store-тексты на всех языках плагина):

```
RU: Добавлены крипто-донаты: новый экран «Поддержать» с оплатой картой (ЮMoney) и криптой — USDT/TON в сети TON на кошелёк Telegram (QR + копирование адреса).
EN: Added crypto donations: a new "Support" screen with card (YooMoney) and crypto — USDT/TON on the TON network to a Telegram wallet (QR + copy address).
```

- [ ] **Step 4: Прогнать весь тест-сьют**

Run: `npm test`
Expected: PASS — все тесты, включая `tests/locales.test.js`, зелёные.

- [ ] **Step 5: Commit** (по разрешению пользователя)

```bash
git add extension/manifest.json package.json CHANGELOG.md
git commit -m "chore(release): v0.14.0 — crypto donations"
```

---

## Финальная проверка (после всех задач)

1. `npm test` — зелёный.
2. Ручной прогон тест-плана из спеки §7 (все 9 пунктов) в Chrome, light+dark, RU+EN.
3. Сверить версию `0.14.0` в manifest, package.json, `chrome://extensions`.
4. QR и текстовый адрес кодируют один и тот же адрес.
