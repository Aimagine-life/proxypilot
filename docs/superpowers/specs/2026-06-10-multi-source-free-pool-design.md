# Мультиисточниковый бесплатный пул прокси — дизайн

**Дата:** 2026-06-10
**Статус:** утверждён, ожидает реализации
**Ветка:** feature/proxypilot-universalization
**Затрагивает:** `extension/lib/free-pool.js`, `tests/free-pool.test.js`, `README.md`

## Проблема

«Бесплатный пул» ProxyPilot тянет один источник — Proxifly
(`extension/lib/free-pool.js`, `POOL_URL`). В живом тесте (1743 прокси из 24
источников, прогон через HTTPS-туннель + повторная верификация) Proxifly показал
live-rate ~6%. Предпроверенные источники дают кратно больше: monosans 39%,
zloi-user/hideip.me 65% (socks5) / 39% (http). Один источник = долгий перебор
кандидатов и частые «рабочий прокси не найден».

## Цель

Расширить пул до нескольких источников, сохранив весь существующий конвейер
(`filterPool` → `pickAndValidate` → `validateProxy`), периодическое обновление
(alarm `free-pool-refresh`, 5 мин) и реактивную ротацию (`handleProxyError`).

## Решения (согласовано)

- **Набор источников:** Proxifly (текущий) + monosans + zloi-user/hideip.me
  (http и socks5) + hookzof/socks5_list + ProxyScrape (GitHub CDN). 6 фидов.
- **Хранение списка:** захардкоженный массив в `free-pool.js` (как сейчас
  `POOL_URL`). Без UI-настройки.
- **Подход слияния:** массив адаптеров → единый нормализованный пул (вариант A).

## Архитектура

### 1. Реестр источников

Заменяет одиночный `POOL_URL` массивом. Каждая запись — `{ name, url, kind, proto? }`:

| name | url | kind | proto |
|---|---|---|---|
| proxifly | `raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.json` | `proxifly` | — |
| proxyscrape | `cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/all/data.json` | `proxyscrape` | — |
| monosans | `raw.githubusercontent.com/monosans/proxy-list/main/proxies.json` | `monosans` | — |
| zloi-http | `raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt` | `hideip` | `http` |
| zloi-socks5 | `raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt` | `hideip` | `socks5` |
| hookzof | `raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt` | `txt` | `socks5` |

### 2. Адаптеры (нормализаторы)

Каждый `kind` имеет парсер `parse(text, proto) -> Array<NormalizedProxy>`, где
`NormalizedProxy = { host, port, protocol, country, score, anonymity, httpsCapable }`
— тот же формат, что сейчас возвращает `normalizePool`. Конвейер ниже не меняется.

**Критично — нормализация `country` к ISO-2.** Фильтр `BLOCKED_COUNTRIES`
(RU/BY/CN/IR) и отсев `ZZ` в `filterPool` сравнивают по ISO-кодам. Источники
отдают страну по-разному:

- `proxifly` — `geolocation.country || country`, **уже ISO** (`"NL"`). Без изменений.
- `proxyscrape` — поле `country` = **полное имя** (`"Germany"`), ISO в
  **`country_code`** (`"DE"`). Брать `country_code`. `ssl`(bool)→httpsCapable,
  `uptime_percent`→score, `anonymity` как есть.
- `monosans` — `host/port/protocol`, ISO в `geolocation.country.iso_code`
  (`"RU"`). Нет `anonymity`/`ssl`/`score`. **В фиде есть RU-записи** — фильтр
  обязателен и срабатывает по iso_code.
- `hideip` — строки `ip:port:CountryFullName` (`"...:Guatemala"`). Полное имя →
  ISO через мини-таблицу **только для блокируемых стран**
  (`Russia→RU, Belarus→BY, China→CN, Iran→IR`); прочие имена → `null`
  (фильтр стран их не трогает, как и текущие `country: null` записи —
  см. тест «unknown country — kept»).
- `txt` — чистый `ip:port`, протокол из `proto`. `country: null`,
  `anonymity: null`.

**httpsCapable** (sort-хинт): `entry.https === true || ssl === true || protocol ∈ {socks4, socks5}`.
Источники без флага (monosans-http, hideip-http) → `false`; финально их всё равно
проверяет `validateProxy` (фетчит HTTPS-URL), так что некорректный http-прокси
отсеется на валидации.

### 3. Слияние, дедуп, score

- `fetchAllSources()` — `Promise.allSettled` по всем источникам, каждый со своим
  таймаутом (`FETCH_TIMEOUT_MS`). Результаты успешных склеиваются.
- Дедуп по ключу `protocol:host:port`. При дубликате: `country`/`anonymity` —
  первое непустое; `score` — максимум; `httpsCapable` — логическое ИЛИ.
- **Дефолтный score по доверию к источнику** для фидов без `score`:
  предпроверенные (monosans, zloi, hookzof) получают базовый вес > 0, чтобы не
  тонуть в сортировке под Proxifly-записями со `score`. Конкретные веса —
  на этапе плана; принцип: предпроверенный фид ≥ дефолта Proxifly.
- `MAX_VALIDATION_ATTEMPTS`: 30 → 40 (пул крупнее и разнообразнее).

### 4. Resilience и кэш

- Падение/таймаут одного источника не роняет остальные (`allSettled`).
- Все источники упали → `fetchPool` бросает (как сейчас) → `pickAndValidate`
  возвращает существующую ошибку «не удалось загрузить список».
- Кэш `chrome.storage.local` (`freeProxyPoolCache`, TTL 5 мин) хранит **уже
  объединённый нормализованный** массив (а не сырой Proxifly JSON). Память-кэш
  и трёхуровневая логика сохраняются.
- Периодика (`free-pool-refresh`) и реактивная ротация (`handleProxyError`) —
  **без изменений**: вызывают `fetchPool({force})` / `pickAndValidate` как прежде.

## Конвейер без изменений

`filterPool`, `validateProxy`, `pickAndValidate`, `nextLiveProxy`,
`background.js` (alarms, ротация, SWITCH_SOURCE/ROTATE_FREE) — не трогаем.
Контракт `fetchPool() -> Array<NormalizedProxy>` сохраняется; меняется только его
внутренняя реализация (один URL → много + мёрж).

## Тестирование (`tests/free-pool.test.js`)

- **Переписать** 6 тестов `fetchPool` под мультиисточник: мок нескольких
  ответов, проверка `allSettled`-склейки и кэша объединённого пула.
- **Добавить** на каждый адаптер: корректная нормализация полей; в т.ч.
  «`country_code` у proxyscrape», «iso_code у monosans», «полное имя→ISO у hideip».
- **Добавить** интеграционные: RU-запись из monosans/zloi отсеивается `filterPool`;
  дедуп `protocol:host:port` с выбором max score; устойчивость — один источник
  бросает, пул собирается из остальных; все источники упали → throw.
- **Без изменений:** тесты `filterPool`, `validateProxy`, `pickAndValidate`,
  `nextLiveProxy`.

## Вне scope

UI-настройка источников; новые протоколы; изменение логики
валидации/ротации/PAC; обновление `data/` и RKN-проверки. README — обновить
список источников в секции «Бесплатный пул» (RU и EN).

## Риски

- Структура фидов может меняться (особенно сторонние JSON). Митигирующее: каждый
  адаптер изолирован, падение фида не критично, есть кэш.
- `score` несопоставим между источниками (Proxifly score vs uptime% vs дефолт).
  Это лишь хинт сортировки — финальное решение принимает `validateProxy`.
- hideip/hookzof без anonymity → не отсеиваются как `transparent`; приемлемо,
  валидация и так проверяет рабочесть.
