# Visible Donate + Colored App Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать донат заметным (постоянная кнопка в футере главного экрана + деликатный баннер благодарности) и заменить серую главную иконку расширения на цветную.

**Architecture:** Всё в существующем popup (HTML/CSS/vanilla JS) и `lib/storage.js`. Новое поле `state.donate {uses, lastShownAt, dismissed}` с backfill. Баннер решает «показывать или нет» один раз при открытии попапа (в `init()`), `renderMain()` только применяет видимость. Иконка — новый брендовый набор `icons/app-*.png` (копия цветных `routed-*`), на который указывает манифест.

**Tech Stack:** Chrome MV3 extension, vanilla JS (ES modules), node:test, PowerShell/sh.

**Spec:** `docs/superpowers/specs/2026-06-12-visible-donate-design.md`

**Не делать:** не добавлять `Co-Authored-By` в коммиты (правило репо/пользователя).

---

### Task 1: storage — поле `donate` + backfill

**Files:**
- Modify: `extension/lib/storage.js` (getDefaultState ~строка 37, loadState ~строка 74)
- Test: `tests/storage.test.js` (добавить в конец)

- [ ] **Step 1: Написать падающие тесты**

В конец `tests/storage.test.js`:

```js
test('getDefaultState: includes donate defaults', () => {
  const s = getDefaultState();
  assert.deepEqual(s.donate, { uses: 0, lastShownAt: 0, dismissed: false });
});

test('loadState: backfills donate for users upgrading from before 0.12.0', async () => {
  await chrome.storage.local.clear();
  await saveState({
    schemaVersion: 2, enabled: false, proxy: null, proxySource: 'manual',
    manualProxy: null, freeProxy: { selected: null, lastError: null, deadHosts: {}, poolFetchedAt: 0 },
    theme: 'auto', resolvedTheme: 'light', presets: {}, customDomains: [],
    // no donate (pre-0.12.0 state)
  });
  const s = await loadState();
  assert.deepEqual(s.donate, { uses: 0, lastShownAt: 0, dismissed: false });
});

test('loadState: existing donate state is preserved as-is', async () => {
  await chrome.storage.local.clear();
  await saveState({
    schemaVersion: 2, enabled: false, proxy: null, proxySource: 'manual',
    manualProxy: null, freeProxy: { selected: null, lastError: null, deadHosts: {}, poolFetchedAt: 0 },
    theme: 'auto', resolvedTheme: 'light', presets: {}, customDomains: [],
    donate: { uses: 7, lastShownAt: 123456, dismissed: true },
  });
  const s = await loadState();
  assert.deepEqual(s.donate, { uses: 7, lastShownAt: 123456, dismissed: true });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test` (в `c:\Users\Konstantin\projects\gemini-unblock`)
Expected: 3 новых теста FAIL (`s.donate` undefined), остальные PASS.

- [ ] **Step 3: Минимальная реализация**

В `extension/lib/storage.js`, в объект `getDefaultState()` после `customDomains: [],`:

```js
    // Donate nudge bookkeeping (added in 0.12.0). `uses` counts popup opens
    // with an active proxy; the thank-you banner shows at >=3 uses, at most
    // once per 14 days, until dismissed.
    donate: { uses: 0, lastShownAt: 0, dismissed: false },
```

В `loadState()` после блока `ownPool backfill`:

```js
  // donate backfill (added in 0.12.0).
  if (!saved.donate) saved.donate = { ...defaults.donate };
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: все тесты PASS (включая 3 новых).

- [ ] **Step 5: Commit**

```bash
git add extension/lib/storage.js tests/storage.test.js
git commit -m "feat(storage): add donate nudge state with backfill"
```

---

### Task 2: цветная главная иконка

**Files:**
- Create: `extension/icons/app-16.png`, `app-32.png`, `app-48.png`, `app-128.png` (копии `icons/light/routed-*.png`)
- Modify: `extension/manifest.json` (`icons`, `action.default_icon`)

- [ ] **Step 1: Скопировать цветные PNG**

PowerShell (из корня репо):

```powershell
foreach ($s in 16,32,48,128) {
  Copy-Item "extension/icons/light/routed-$s.png" "extension/icons/app-$s.png"
}
```

- [ ] **Step 2: Обновить манифест**

В `extension/manifest.json` заменить оба блока иконок:

```json
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "ProxyPilot",
    "default_icon": {
      "16": "icons/app-16.png",
      "32": "icons/app-32.png",
      "48": "icons/app-48.png",
      "128": "icons/app-128.png"
    }
  },
  "icons": {
    "16": "icons/app-16.png",
    "32": "icons/app-32.png",
    "48": "icons/app-48.png",
    "128": "icons/app-128.png"
  },
```

Тулбарная state-машина (`lib/icon.js`) НЕ меняется.

- [ ] **Step 3: Проверка**

Run: `ls extension/icons/app-*.png` → 4 файла.
Прочитать `extension/icons/app-128.png` (Read tool) → цветная фиолетовая «P» с бирюзовой точкой.
`npm test` → PASS (регрессий нет).

- [ ] **Step 4: Commit**

```bash
git add extension/icons/app-16.png extension/icons/app-32.png extension/icons/app-48.png extension/icons/app-128.png extension/manifest.json
git commit -m "feat(icons): colored brand icon for store and toolbar default"
```

---

### Task 3: кнопка «Поддержать» в футере главного экрана

**Files:**
- Modify: `extension/popup/popup.html` (футер `.app-footer`, строки 61–65)
- Modify: `extension/popup/popup.css` (блок `.app-footer`, ~строка 665)

- [ ] **Step 1: HTML — двухстрочный футер**

Заменить в `extension/popup/popup.html`:

```html
      <footer class="app-footer">
        <span>Сделано в</span>
        <a class="app-footer-link" href="https://wildbots.ru/" target="_blank" rel="noopener noreferrer">Wildbots ↗</a>
        <button type="button" class="app-footer-about" id="open-about" title="О разработчике">О разработчике</button>
      </footer>
```

на:

```html
      <footer class="app-footer">
        <a class="footer-donate" href="https://yoomoney.ru/to/410011076392857" target="_blank" rel="noopener noreferrer">💛 Поддержать проект</a>
        <div class="app-footer-row">
          <span>Сделано в</span>
          <a class="app-footer-link" href="https://wildbots.ru/" target="_blank" rel="noopener noreferrer">Wildbots ↗</a>
          <button type="button" class="app-footer-about" id="open-about" title="О разработчике">О разработчике</button>
        </div>
      </footer>
```

- [ ] **Step 2: CSS**

В `extension/popup/popup.css` заменить правило `.app-footer { ... }`:

```css
.app-footer {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 16px 10px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-mute);
}
.app-footer-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
/* Постоянная точка входа в донат — янтарная, в стиле .about-cta-heart. */
.footer-donate {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  border-radius: 9px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.32);
  color: var(--amber-ink);
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
  transition: transform 0.1s, background 0.15s;
}
.footer-donate:hover { background: rgba(245, 158, 11, 0.2); }
.footer-donate:active { transform: translateY(1px); }
```

Важно: сохранить существующие правила `.app-footer-link`, `.app-footer-about` без изменений (они теперь внутри `.app-footer-row`, селекторы по классам продолжают работать).

- [ ] **Step 3: Проверка**

`npm test` → PASS. Визуально: открыть попап в Chrome (`chrome://extensions` → load unpacked `extension/`) или отложить до общей ручной проверки в Task 5.

- [ ] **Step 4: Commit**

```bash
git add extension/popup/popup.html extension/popup/popup.css
git commit -m "feat(popup): permanent donate button in main-screen footer"
```

---

### Task 4: баннер благодарности с деликатной логикой показа

**Files:**
- Modify: `extension/popup/popup.html` (первым элементом внутри `.main-scroll`, строка ~39)
- Modify: `extension/popup/popup.css` (рядом с `.ai-free-banner`, ~строка 1010)
- Modify: `extension/popup/popup.js` (`init()` ~строка 19, `renderMain()` ~строка 125, `bindMain()` ~строка 263)

- [ ] **Step 1: HTML баннера**

В `extension/popup/popup.html` сразу после `<div class="main-scroll">`:

```html
      <div class="donate-banner" id="donate-banner" hidden>
        <span class="donate-banner-icon">💛</span>
        <span class="donate-banner-text">Нравится ProxyPilot? Поддержи проект</span>
        <a class="donate-banner-btn" id="donate-banner-link" href="https://yoomoney.ru/to/410011076392857" target="_blank" rel="noopener noreferrer">Поддержать</a>
        <button type="button" class="donate-banner-close" id="donate-banner-close" title="Больше не показывать">×</button>
      </div>
```

- [ ] **Step 2: CSS баннера**

В `extension/popup/popup.css` после блока `.ai-free-banner[hidden] { display: none; }`:

```css
/* Donate thank-you banner — тёплый янтарный, в семействе ai-free-banner. */
.donate-banner {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 9px 10px 9px 12px;
  margin: 8px 0;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.32);
  border-radius: 10px;
  font-size: 11px;
  color: var(--amber-ink);
}
.donate-banner[hidden] { display: none; }
.donate-banner-icon { flex: 0 0 auto; font-size: 14px; }
.donate-banner-text { flex: 1 1 auto; font-weight: 600; }
.donate-banner-btn {
  flex: 0 0 auto;
  padding: 5px 10px;
  border-radius: 7px;
  background: var(--amber);
  color: #fff;
  font-weight: 700;
  text-decoration: none;
}
.donate-banner-btn:hover { filter: brightness(1.08); }
.donate-banner-close {
  flex: 0 0 auto;
  background: none;
  border: 0;
  padding: 2px 4px;
  font-size: 15px;
  line-height: 1;
  color: var(--amber-ink);
  opacity: 0.6;
  cursor: pointer;
}
.donate-banner-close:hover { opacity: 1; }
```

- [ ] **Step 3: JS — логика показа**

В `extension/popup/popup.js`:

1. К module-level переменным (после `let confettiRunning = false;`, строка 13):

```js
let donateBannerDue = false;     // decided once per popup open in updateDonateNudge()
```

2. Константа (после `SOURCE_SHORT`, ~строка 17):

```js
const DONATE_REPEAT_MS = 14 * 24 * 60 * 60 * 1000; // re-show thank-you banner at most every 14 days
```

3. Новая функция (перед `init()`):

```js
// Donate nudge: count "useful" popup opens (proxy enabled + active source) and
// decide ONCE per open whether the thank-you banner is due. renderMain() only
// applies the precomputed decision, so re-renders never re-trigger it.
async function updateDonateNudge() {
  const active = state.enabled && (
    (state.proxySource === 'manual' && state.proxy?.host) ||
    (state.proxySource === 'free' && state.freeProxy?.selected) ||
    (state.proxySource === 'own' && state.ownPool?.selected));
  if (!active) return;

  state.donate.uses += 1;
  if (state.donate.uses >= 3 && !state.donate.dismissed &&
      Date.now() - (state.donate.lastShownAt || 0) >= DONATE_REPEAT_MS) {
    donateBannerDue = true;
    state.donate.lastShownAt = Date.now();
  }
  await persist();
}
```

4. В `init()` — вызов после `state = await loadState();`:

```js
  await updateDonateNudge();
```

5. В `renderMain()` — в конец функции (после блока `aiBanner`):

```js
  $('#donate-banner').hidden = !donateBannerDue;
```

6. В `bindMain()` — обработчики (в конец функции):

```js
  $('#donate-banner-close').addEventListener('click', async () => {
    state.donate.dismissed = true;
    donateBannerDue = false;
    await persist();
    renderMain();
  });
  // Клик по «Поддержать» = пользователь отреагировал — баннер больше не нужен
  // (постоянная кнопка в футере остаётся). Переходу по ссылке не мешаем.
  $('#donate-banner-link').addEventListener('click', () => {
    state.donate.dismissed = true;
    donateBannerDue = false;
    persist();
  });
```

- [ ] **Step 4: Проверка**

`npm test` → PASS.

Ручная проверка логики (Chrome, load unpacked `extension/`):
1. Свежий профиль/очищенный storage: открыть попап с выключенным прокси → баннера нет, `donate.uses` не растёт.
2. Включить прокси (любой источник) → открыть/закрыть попап 3 раза → на 3-м открытии баннер виден.
3. В DevTools service worker: `chrome.storage.local.get('state')` → `donate.lastShownAt` выставлен, `uses >= 3`.
4. Крестик → баннер исчез; повторные открытия → не возвращается (`dismissed: true`).

- [ ] **Step 5: Commit**

```bash
git add extension/popup/popup.html extension/popup/popup.css extension/popup/popup.js
git commit -m "feat(popup): gentle donate thank-you banner (3+ uses, 14d cooldown)"
```

---

### Task 5: бамп версии, сборка, финальная проверка

**Files:**
- Modify: `extension/manifest.json` (`"version"`)
- Modify: `package.json` (`"version"`)

- [ ] **Step 1: Бамп версии**

`extension/manifest.json`: `"version": "0.11.13"` → `"version": "0.12.0"`.
`package.json`: `"version": "0.11.13"` → `"version": "0.12.0"`.

- [ ] **Step 2: Тесты и сборка**

Run: `npm test` → все PASS.
Run: `bash scripts/build.sh` → `Готово: dist/chrome/proxypilot-0.12.0.zip, dist/firefox/proxypilot-0.12.0.zip`.

- [ ] **Step 3: Ручная smoke-проверка попапа**

Load unpacked `extension/` в Chrome:
- иконка расширения в `chrome://extensions` и тулбаре (до включения) — цветная;
- футер главного экрана: янтарная кнопка «💛 Поддержать проект» + строка Wildbots/О разработчике;
- обе донат-ссылки открывают YooMoney в новой вкладке;
- экран «О разработчике» не сломан.

- [ ] **Step 4: Commit**

```bash
git add extension/manifest.json package.json
git commit -m "chore: bump version to 0.12.0"
```
