# Публикация ProxyPilot на Firefox Add-ons (AMO)

## Пакет
`sh scripts/build.sh` → `dist/firefox/proxypilot-<ver>.zip` (manifest.json в корне,
`background.scripts`, `browser_specific_settings.gecko`, без `webRequestAuthProvider`).

## Аккаунт
https://addons.mozilla.org/developers/ — регистрация бесплатна (взноса нет, в отличие
от Chrome).

## Пошаговая подача — что вводить и какие галки

Submit a New Add-on (https://addons.mozilla.org/developers/addon/submit/distribution):

1. **How to distribute → «On this site»** (публичный листинг в каталоге AMO).
   («On your own» = unlisted, только для самостоятельной раздачи `.xpi`, не публичный.)
2. **Upload** → выбери `dist/firefox/proxypilot-<ver>.zip`. Дождись валидации (должна
   пройти без ошибок/предупреждений на v0.11.13+).
3. **«Do you use minified/generated code?» → No.** Сборка лишь копирует файлы и патчит
   манифест, минификации нет → исходники загружать не нужно. Если форма всё равно
   попросит — дай ссылку на репозиторий в «Notes to reviewer».
4. **Add-on details** (поля):
   - **Name:** `ProxyPilot`
   - **Summary** (кратко): текст из `docs/chrome-web-store/PUBLISHING.md` §3 (110 символов).
   - **Description** (подробно): блок «Подробное описание» оттуда же (§3).
   - **Categories:** отметь **Privacy & Security** (можно добавить **Other**). Если форма
     показывает отдельно категории для Firefox и для Android — выбери те же в обеих.
   - **Tags** (опц.): proxy, vpn, ai, geo, unblock.
   - **Support email:** твой контактный email.
   - **Homepage / Support site:** `https://wildbots.ru/` (или репозиторий на GitHub).
   - **License:** обязательно. Если код открытый — выбери **MIT** или **MPL-2.0**; если
     хочешь закрытый — **All Rights Reserved** (custom). См. примечание ниже.
   - **Privacy Policy:** **обязательно** — вставь текст из `docs/chrome-web-store/privacy-policy.md`
     (или укажи URL, если разместишь на сайте).
5. **Сбор данных (Data collection):** в манифесте уже стоит
   `data_collection_permissions: { required: ["none"] }`, поэтому AMO покажет «не собирает
   данные» — подтверди это, ничего как собираемое НЕ отмечай (расширение и правда ничего
   не передаёт; логика та же, что в Chrome §6).
6. **Images:** иконка подтянется из пакета; **Screenshots** — загрузи
   `docs/chrome-web-store/screenshots/01-main.png`, `02-free-pool.png`, `03-active-source.png`
   (1280×800). Promo-плитка на AMO не требуется.
7. **Notes to reviewer** (важно — proxy-расширения смотрят вручную), готовый текст:
   > ProxyPilot routes only user-selected domains through a proxy (Chrome PAC / Firefox
   > `proxy.onRequest`); other traffic stays direct. It does not read or modify page
   > content and collects no user data. No minified/bundled code — the published files
   > are the source. Build for reference: `sh scripts/build.sh` (copies files + patches
   > the manifest for Firefox). Repo: https://github.com/Aimagine-life/proxypilot
8. **Version notes** (changelog): напр. «Первый релиз: маршрутизация по доменам, свой/
   свой пул/бесплатный прокси, светлая/тёмная тема».

### Про лицензию
В репозитории сейчас нет файла лицензии. На AMO лицензию всё равно нужно выбрать из
списка. Варианты: **MIT** или **MPL-2.0** (открытый код) либо **All Rights Reserved**
(закрытый). Если выберешь открытую — стоит добавить файл `LICENSE` в репозиторий.

### Откуда брать ассеты
- Название / Summary / Description — `docs/chrome-web-store/PUBLISHING.md` §3.
- Иконка — `extension/icons/light/off-128.png`.
- Скриншоты — `docs/chrome-web-store/screenshots/` (те же 1280×800).
- Privacy policy — `docs/chrome-web-store/privacy-policy.md`.

## Разрешения (обоснования те же, что в Chrome §5)
`<all_urls>` — для `proxy.onRequest` и webRequest-ротации мёртвого прокси. Авторизация
прокси в Firefox задаётся **инлайн в дескрипторе** `proxy.onRequest` — поэтому
`webRequestAuthProvider` в Firefox-манифесте нет. Расширение не читает и не изменяет
содержимое страниц, не собирает данные пользователя.

## Источники (Source code submission)
Mozilla может запросить исходники. Сборка лишь копирует файлы и патчит манифест
(`scripts/build.sh`) — минификации/бандла нет, рецензент собирает тем же скриптом.
Укажи в поле «Notes to reviewer»:
> Source = the `extension/` folder as published. Build is `sh scripts/build.sh`
> (copies files + patches manifest for Firefox). No minification, no bundler.

## Технические отличия Firefox-сборки (для справки)
- `background` — event page (`scripts`), не service worker.
- Проксирование — `browser.proxy.onRequest` (per-request), не PAC.
- `strict_min_version`: 140.0 (desktop) / 142.0 (Android) — там, где Firefox добавил
  поддержку `data_collection_permissions` (ниже AMO предупреждает). Сами фичи (MV3,
  ES-модули, `proxy.onRequest`) работают и раньше.

## После публикации
Если решишь показывать кнопку «Оценить» для Firefox-сборки — добавь ссылку на страницу
AMO в `extension/popup/popup.html` (блок `id="about-rate"`), по аналогии с Chrome (см.
`docs/chrome-web-store/PUBLISHING.md` §7).
