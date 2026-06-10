# Установка ProxyPilot вручную

**[Русский](#установка) · [English](#manual-installation-en)**

## Установка

Самый простой и надёжный способ — поставить из магазина (Chrome Web Store / Firefox
Add-ons), когда расширение там опубликовано: установка в один клик, подпись и
авто-обновления. Ниже — как поставить **вручную** до публикации.

### Что скачать

- Через Git: `git clone https://github.com/Aimagine-life/proxypilot.git`
- Или кнопкой **Code → Download ZIP** на странице репозитория и распаковать.

(Для Firefox понадобится собрать пакет — см. ниже. Для Chrome сборка не нужна.)

---

### Chrome / Edge / Brave / другие Chromium

Сборка не требуется — грузим папку `extension/` как есть.

1. Открой `chrome://extensions` (в Edge — `edge://extensions`).
2. Включи **Режим разработчика** (переключатель справа сверху).
3. Нажми **Загрузить распакованное** и выбери папку **`extension/`** из скачанного репозитория.
4. Иконка ProxyPilot появится в панели. Кликни по ней → **Настройки**.

**Нюансы:**
- Chrome при каждом запуске может показывать баннер «Отключите расширения, работающие
  в режиме разработчика» — это нормально для ручной установки, нажми «Оставить».
- Скачать `.zip`/`.crx` и «установить двойным кликом» нельзя — Chrome разрешает только
  «распакованное» или установку из Web Store.

---

### Firefox

В `extension/manifest.json` лежит вариант для Chrome (service worker), который Firefox
не примет. Поэтому для Firefox нужен **отдельно собранный пакет** с Firefox-манифестом.

**Шаг 1. Собрать пакет** (нужен установленный Python):
```sh
sh scripts/build.sh
# → dist/firefox/proxypilot-<версия>.zip
```

**Шаг 2. Установить.** Тут важно, какой у тебя Firefox:

- **Обычный Firefox (release):** постоянно ставится **только подписанный** `.xpi`
  (требование Mozilla). Неподписанный пакет можно загрузить лишь **временно**:
  1. Открой `about:debugging#/runtime/this-firefox`
  2. **Load Temporary Add-on…** → выбери `dist/firefox/proxypilot-<версия>.zip`
  3. Работает до закрытия Firefox (после перезапуска нужно загрузить снова).

- **Firefox Developer Edition / Nightly / ESR:** можно ставить неподписанное навсегда:
  1. Открой `about:config`, найди `xpinstall.signatures.required` → поставь `false`.
  2. Открой `about:addons` → шестерёнка → **Install Add-on From File…** → выбери
     `dist/firefox/proxypilot-<версия>.zip`.

**Для постоянной установки в обычный Firefox** нужен подписанный `.xpi` — он получается
после публикации/подписания на [AMO](https://addons.mozilla.org/developers/) (бесплатно).
До этого используй временную загрузку или Developer Edition.

---

### Обновление и удаление

- **Обновить:** скачай свежую версию и повтори шаги (в Chrome — кнопка ↻ на карточке
  расширения в `chrome://extensions`).
- **Удалить:** на странице расширений нажми «Удалить».

### Важно про бесплатный пул прокси

Бесплатные публичные прокси крутят сторонние люди. Не входи в важные аккаунты, пока
трафик идёт через них. Для надёжности укажи свой прокси в настройках.

---

# Manual installation (EN)

The easiest way is the store (Chrome Web Store / Firefox Add-ons) once published —
one-click install, signing, auto-updates. Below is **manual** install before that.

**Get the files:** `git clone https://github.com/Aimagine-life/proxypilot.git` or
**Code → Download ZIP** and unzip. (Firefox needs a build step; Chrome does not.)

### Chrome / Edge / Brave / Chromium

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** → select the **`extension/`** folder.
4. Click the ProxyPilot icon → **Settings**.

Notes: Chrome may show a "Disable developer-mode extensions" banner on startup — that's
normal for manual installs. You cannot install a `.zip`/`.crx` by double-click — only
"Load unpacked" or the Web Store.

### Firefox

`extension/manifest.json` is the Chrome variant (service worker), which Firefox won't
accept — build the Firefox package first (requires Python):
```sh
sh scripts/build.sh   # → dist/firefox/proxypilot-<version>.zip
```

- **Regular (release) Firefox:** only **signed** `.xpi` installs permanently. For an
  unsigned build use a **temporary** load: `about:debugging#/runtime/this-firefox` →
  **Load Temporary Add-on…** → pick the zip (gone after restart).
- **Developer Edition / Nightly / ESR:** set `xpinstall.signatures.required` to `false`
  in `about:config`, then `about:addons` → **Install Add-on From File…** → pick the zip.

Permanent install in regular Firefox needs a signed `.xpi` from
[AMO](https://addons.mozilla.org/developers/) (free).

### Heads-up about the free proxy pool

Free public proxies are run by strangers — don't sign into important accounts while
routed through them. Use your own proxy for reliability.
