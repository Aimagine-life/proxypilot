# Порт ProxyPilot на Firefox — дизайн

**Дата:** 2026-06-10
**Статус:** утверждён, ожидает плана
**Ветка:** main (порт делать в отдельной ветке)
**Затрагивает:** `extension/lib/proxy.js`, `extension/background.js`, `extension/lib/free-pool.js` (validateProxy), `extension/manifest.json`, тесты, сборку, `docs/firefox-amo/`

## Проблема и цель

ProxyPilot — это Chrome MV3 расширение. Цель — выпустить его и для Firefox (AMO),
сохранив один общий исходник. Главное расхождение браузеров — **способ применения
прокси**: Chrome использует PAC-скрипт через `chrome.proxy.settings`, Firefox —
пер-запросный слушатель `browser.proxy.onRequest`. Остальной код (UI, хранилище,
пресеты, РКН, загрузка/фильтрация пула) переносится почти без изменений.

## Согласованные решения

- **Единая кодовая база + мини-билд.** Один `extension/` исходник; скрипт сборки
  кладёт код + нужный манифест в `dist/chrome/` и `dist/firefox/` и пакует два zip.
- Прокси-слой — **рантайм-адаптер** с двумя бэкендами (выбор по фиче-детекту).
- Namespace — лёгкий шим `globalThis.browser ??= chrome` (код переводится на
  `browser.*`, промисы в обоих браузерах). webextension-polyfill — запасной вариант,
  если какой-то API в Chrome MV3 окажется не-промисным.
- Минимальная версия Firefox: **140+ desktop / 142+ Android** (там, где добавлен ключ `data_collection_permissions`, обязательный для AMO; сами фичи — MV3, ES-модули, `proxy.onRequest` — работают и с 121).

## Архитектура

### 1. Прокси-адаптер (ядро)

Выделяем интерфейс в `extension/lib/proxy-backend.js`:
```
applyProxy(state)      // включить маршрутизацию по state
clearProxy()           // выключить
validateProxy(cand)    // прогнать тест-URL через кандидата, вернуть {ok, latencyMs}
```
Фиче-детект: `const isFirefox = typeof browser !== 'undefined' && browser.proxy && browser.proxy.onRequest;`

**Chrome-бэкенд** (как сейчас): `buildPacScript(state)` → `browser.proxy.settings.set({mode:'pac_script', pacScript:{data, mandatory:true}})`; `clearProxy` → `settings.clear`; `validateProxy` — временный PAC=ALL→кандидат + fetch тест-URL.

**Firefox-бэкенд:** один слушатель `browser.proxy.onRequest` (фильтр `<all_urls>`),
который держит в памяти текущий `state` (обновляется по `storage.onChanged`) и на
каждый запрос решает через **существующую** `isHostRouted(host, state)`:
```
function handleProxyRequest(info) {
  const host = new URL(info.url).hostname;
  if (active && isHostRouted(host, state)) {
    const p = state.proxy;
    return { type: ffType(p.scheme), host: p.host, port: Number(p.port),
             username: p.user || undefined, password: p.pass || undefined,
             proxyDNS: p.scheme.startsWith('socks') };
  }
  return { type: 'direct' };
}
```
где `ffType`: http→'http', https→'https', socks5→'socks', socks4→'socks4'.
- `applyProxy` — регистрирует слушатель (один раз) и обновляет `state` в памяти.
- `clearProxy` — `state.enabled=false`, слушатель возвращает `direct`.
- `validateProxy` — временный флаг: для тест-URL вернуть кандидата, fetch, снять флаг.
- **Авторизация прокси — инлайн** в дескрипторе (`username`/`password`) → отдельный
  `onAuthRequired` для прокси в Firefox НЕ нужен.

Доменная логика (`collectDomains`, `isHostRouted` из `pac.js`) переиспользуется
обоими бэкендами без изменений — единый источник правды о маршрутизации.

### 2. Авторизация и ротация (webRequest)

- **Chrome:** как сейчас — `onAuthRequired` (asyncBlocking) + `onErrorOccurred`.
- **Firefox:** авторизация инлайн (см. выше). Ротация мёртвого прокси —
  `browser.webRequest.onErrorOccurred` поддерживается; используем его же.
  Если на Firefox потребуется — fallback на ошибки внутри `onRequest`.

Эти ветки изолируются в адаптере/`registerProxyErrorListener`, разводятся по
`isFirefox`.

### 3. Namespace

В начале background и popup: `globalThis.browser ??= chrome;` Затем по коду
механически `chrome.*` → `browser.*`. Спорные Chrome-специфичные вызовы
(`onAuthRequired` asyncBlocking) живут только в Chrome-ветке адаптера.

### 4. Манифест и сборка

`extension/manifest.json` остаётся Chrome-каноничным (`background.service_worker`).
`scripts/build.sh`:
1. Чистит `dist/`.
2. Для Chrome: копирует `extension/` → `dist/chrome/`, манифест как есть, zip.
3. Для Firefox: копирует `extension/` → `dist/firefox/`, патчит манифест —
   `background` → `{ "scripts": ["background.js"], "type": "module" }`,
   добавляет `browser_specific_settings.gecko` (id `proxypilot@wildbots.ru`,
   `strict_min_version: "121.0"`), убирает `webRequestAuthProvider` (Chrome-only),
   zip.
Патч манифеста — маленький python-шаг (как `build-dist.sh`).

### 5. Тестирование (`node --test`)

- Тестовый сетап присваивает мок в `globalThis.browser` (а не только `chrome`).
- Существующие 120 тестов сохраняются (после правки мока и `chrome.`→`browser.`).
- Новые тесты Firefox-адаптера: `handleProxyRequest` возвращает правильный дескриптор
  для routed-хоста (http/https/socks с верным `type`/`proxyDNS`/инлайн-авторизацией)
  и `direct` для не-routed; `validateProxy` Firefox-путь (мок onRequest + fetch).
- Фиче-детект: тест выбирает нужный бэкенд по наличию `browser.proxy.onRequest`.

### 6. Публикация (AMO)

Бесплатно. `docs/firefox-amo/` — листинг (переиспользует тексты Chrome),
переиспользуемые скриншоты/иконки, ссылка на ту же privacy-policy. Нюанс: ручное
ревью proxy-расширений; исходники без минификации/сборки-в-бандл проходят легко
(сборка лишь копирует файлы и патчит манифест — рецензент собирает тем же скриптом).

## Контракты (неизменны)

- `collectDomains(state)`, `isHostRouted(host, state)`, `buildPacScript(state)` — без изменений.
- Форма `state` (storage) — без изменений.
- UI/popup — без изменений (только `chrome.`→`browser.`).

## Вне scope

Новые фичи; изменение UI/дизайна; поддержка Firefox < 121; Safari/другие браузеры;
изменение логики подбора прокси и фильтрации пула.

## Риски

- **ES-модули в Firefox background event page** — поддержка с 121; если у целевой
  аудитории старее — fallback на classic-скрипт (importScripts-эквивалент) в сборке.
- **Шим `browser ??= chrome`** — если какой-то Chrome MV3 API окажется не-промисным,
  точечно обернуть или подключить webextension-polyfill (запасной план).
- **onErrorOccurred на Firefox** для ротации — проверить поведение; при проблемах
  детектить отказ через `onRequest`/таймауты.
- **Инлайн-авторизация Firefox** — проверить, что `username`/`password` в дескрипторе
  работают для http и socks; иначе использовать `onAuthRequired` (промис) на Firefox.
