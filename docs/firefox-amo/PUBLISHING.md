# Публикация ProxyPilot на Firefox Add-ons (AMO)

## Пакет
`sh scripts/build.sh` → `dist/firefox/proxypilot-<ver>.zip` (manifest.json в корне,
`background.scripts`, `browser_specific_settings.gecko`, без `webRequestAuthProvider`).

## Аккаунт
https://addons.mozilla.org/developers/ — регистрация бесплатна (взноса нет, в отличие
от Chrome).

## Листинг (переиспользуем Chrome-материалы)
- Название / краткое / подробное описание — из `docs/chrome-web-store/PUBLISHING.md` §3.
- Иконка — `extension/icons/light/off-128.png` (бренд-монограмма P).
- Скриншоты — `docs/chrome-web-store/screenshots/` (AMO принимает те же 1280×800).
- Категория: Privacy & Security (или Other).
- Privacy policy — тот же текст/URL, что для Chrome
  (`docs/chrome-web-store/privacy-policy.md`).

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
