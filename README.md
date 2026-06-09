# ProxyPilot

**Русский · [English](#proxypilot-en)**

Расширение для Chromium, которое направляет AI-сервисы и другие гео-ограниченные сайты через ваш прокси или подобранный бесплатный.

## Установка

1. Скачайте или клонируйте репозиторий
2. Откройте `chrome://extensions`
3. Включите **Режим разработчика**
4. Нажмите **Загрузить распакованное** → выберите папку `extension/`

## Настройка

Доступны три источника прокси — выбирай в **Настройки → Источник прокси**:
**Свой** (один прокси), **Свой пул** (список своих прокси с авто-ротацией —
вставь по строке `socks5://user:pass@host:port` / `http://host:port` /
`host:port:user:pass`; при отказе текущего плагин сам берёт следующий) и
**Бесплатный пул**.

### A. Свой прокси (рекомендуется)

1. Кликни на иконку расширения → **Открыть настройки** → **Свой**
2. Вставь прокси в любом формате:
   - `host:port:user:pass` (формат провайдера)
   - `socks5://user:pass@host:port`
   - `http://host:port`
3. Протокол определяется автоматически — или выбери вручную
4. Нажми **Проверить прокси** для верификации
5. Вернись назад, включи главный переключатель

### B. Бесплатный пул (если своего прокси нет)

1. **Настройки → Источник прокси → Бесплатный пул**
2. Расширение тянет несколько публичных списков сразу — [Proxifly](https://github.com/proxifly/free-proxy-list), [ProxyScrape](https://github.com/ProxyScrape/free-proxy-list), [monosans](https://github.com/monosans/proxy-list), [hideip.me](https://github.com/zloi-user/hideip.me) (http+socks5) и [hookzof](https://github.com/hookzof/socks5_list) — объединяет их с дедупом, отфильтровывает `transparent`-анонимность и страны `RU·BY·CN·IR`, сортирует по доверию/`score`, и последовательно проверяет кандидатов через нейтральный пробник пока не найдёт живой
3. В реальном времени показывается прогресс: `Проверка N/M · host:port`. Если ничего живого не нашлось — сообщение с количеством проверенных
4. Кнопка **↻ Сменить** помечает текущий как мёртвый и ищет другой

**Важно:** бесплатные прокси крутят случайные люди. Не входи в Google-аккаунт и другие важные сервисы, когда трафик идёт через них — Google почти наверняка пометит вход как подозрительный. В popup есть явный жёлтый баннер когда `Бесплатный пул` активен вместе с любым AI-сервисом.

UI расширения на русском (`<html lang="ru">`). Имена пресетов сервисов оставлены по-английски.

## Поддерживаемые сервисы

Кнопки сгруппированы по категориям. Все сервисы геоблокают РФ со своей стороны и
отсутствуют в реестре РКН.

- **AI-ассистенты:** Gemini, AI Studio, NotebookLM, Google Labs, ChatGPT, Claude, Perplexity, Grok, MS Copilot ⚠️, Poe
- **AI: код · медиа · голос:** JetBrains AI, GitHub Copilot ⚠️, Suno, Sora, ElevenLabs
- **Видео:** YouTube, Netflix, Disney+, Max (HBO), Prime Video, Apple TV+, Paramount+, Peacock, Hulu, Crunchyroll, MUBI
- **Музыка:** Spotify, Deezer, Tidal
- **Дизайн и продуктивность:** Figma ⚠️, Notion ⚠️
- **Сайты · хостинг · магазины:** Wix ⚠️, Shopify ⚠️, Namecheap ⚠️
- **Работа · команды · dev:** Slack ⚠️, Mailchimp ⚠️, Upwork ⚠️, CircleCI ⚠️
- **18+:** Pornhub

**⚠️ Блок по аккаунту/карте (не только по IP):** для этих сервисов прокси открывает сайт, но полный доступ требует ещё **не-РФ аккаунта и/или не-РФ карты** (санкции/резидентство). Прокси один не вернёт уже заблокированный РФ-аккаунт.

**Про стриминг (Netflix, Disney+, Max, Prime Video, Spotify и т.п.):** эти сервисы агрессивно детектят дата-центровые прокси («You seem to be using a proxy»). Надёжно открываются только через **резидентный/мобильный прокси** — бесплатный пул (датацентр) для них почти всегда не подойдёт. Для оплаты подписки нужна не-РФ карта (IP открывает только каталог).

Также можно добавить свои домены — они проверяются в реестре РКН перед добавлением. Заблокированные Роскомнадзором домены не принимаются.

Google Auth (accounts.google.com) подключается автоматически при включении любого Google AI сервиса.

## Соответствие закону

Расширение проверяет, не заблокированы ли маршрутизируемые домены Роскомнадзором. Если домен находится в реестре РКН, маршрутизация автоматически отключается в соответствии с законодательством РФ (149-ФЗ). Проверка выполняется при запуске и каждые 24 часа.

## Протоколы

HTTP, HTTPS, SOCKS5, SOCKS4. Автоопределение протокола. Аутентификация поддерживается.

## Технологии

Manifest V3, чистый JS, без зависимостей, без сборки. Тесты: `npm test`.

Упаковка: в дистрибутив кладётся **только папка `extension/`** (`cd extension && zip -r ../dist/proxypilot.zip .`) — `data/` (список РКН тянется по сети), `docs/` и dev-файлы в пакет не входят.

---

# ProxyPilot (EN)

**[Русский](#proxypilot) · English**

Chromium extension that routes AI services and other geo-restricted sites through your own proxy — or a curated free pool when you don't have one.

## Install

1. Download or clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `extension/` folder

## Setup

Three sources are available — pick one in **Settings → Proxy source**:
**Your own** (single proxy), **Own pool** (your own list with auto-rotation —
one per line: `socks5://user:pass@host:port` / `http://host:port` /
`host:port:user:pass`; if the current one stops responding the extension picks
the next) and the **Free pool**.

### A. Your own proxy (recommended)

1. Click the extension icon → **Open settings** → **Manual**
2. Paste your proxy in any format:
   - `host:port:user:pass` (provider format)
   - `socks5://user:pass@host:port`
   - `http://host:port`
3. Protocol is auto-detected — or pick manually
4. Click **Test proxy** to verify
5. Go back, enable the master toggle

### B. Free pool (no own proxy needed)

1. **Settings → Proxy source → Free pool**
2. The extension fetches several public lists at once — [Proxifly](https://github.com/proxifly/free-proxy-list), [ProxyScrape](https://github.com/ProxyScrape/free-proxy-list), [monosans](https://github.com/monosans/proxy-list), [hideip.me](https://github.com/zloi-user/hideip.me) (http+socks5) and [hookzof](https://github.com/hookzof/socks5_list) — merges and dedupes them, filters out transparent anonymity and `RU·BY·CN·IR`, sorts by trust/`score`, and validates candidates against a neutral probe until one works
3. Live progress shows `Проверка N/M · host:port`; if everything's dead, the full pool count is reported
4. Click **↻ Rotate** to drop the current pick and find another

**Important:** free proxies are operated by random people. Avoid logging into Google / accounts you care about while routed through them — Google will likely flag the sign-in. The popup shows an explicit warning banner when Free pool is active with any AI service enabled.

UI language: Russian (`<html lang="ru">`). Service preset names stay in English.

## Supported services

Buttons are grouped by category. Every service geo-blocks Russia from its own
side and is absent from the RKN registry.

- **AI assistants:** Gemini, AI Studio, NotebookLM, Google Labs, ChatGPT, Claude, Perplexity, Grok, MS Copilot ⚠️, Poe
- **AI: code · media · voice:** JetBrains AI, GitHub Copilot ⚠️, Suno, Sora, ElevenLabs
- **Video:** YouTube, Netflix, Disney+, Max (HBO), Prime Video, Apple TV+, Paramount+, Peacock, Hulu, Crunchyroll, MUBI
- **Music:** Spotify, Deezer, Tidal
- **Design & productivity:** Figma ⚠️, Notion ⚠️
- **Sites · hosting · commerce:** Wix ⚠️, Shopify ⚠️, Namecheap ⚠️
- **Work · teams · dev:** Slack ⚠️, Mailchimp ⚠️, Upwork ⚠️, CircleCI ⚠️
- **18+:** Pornhub

**⚠️ Account/card-gated (not just IP):** the proxy opens the site, but full access also needs a **non-RU account and/or non-RU card** (sanctions/residency). A proxy alone won't restore an already-blocked RU account.

**About streaming (Netflix, Disney+, Max, Prime Video, Spotify, …):** these services aggressively detect datacenter proxies ("You seem to be using a proxy"). They reliably open only through a **residential/mobile proxy** — the free pool (datacenter) will almost always fail for them. Paying for a subscription needs a non-RU card (the IP only unlocks the catalog).

Custom domains can also be added — they're checked against the RKN registry before being accepted. RKN-blocked domains are rejected.

Google Auth (accounts.google.com) is auto-routed when any Google AI service is enabled.

## RKN compliance

The extension checks whether routed domains are blocked by Roskomnadzor. If a domain is in the RKN registry, routing is automatically disabled to comply with Russian law (149-FZ). Checks run on startup and every 24 hours.

## Proxy protocols

HTTP, HTTPS, SOCKS5, SOCKS4. Auto-detection supported. Authentication supported.

## Tech

Manifest V3, vanilla JS, no dependencies, no build step. Tests: `npm test`.

Packaging: ship **only the `extension/` folder** (`cd extension && zip -r ../dist/proxypilot.zip .`) — `data/` (the RKN list is fetched over the network), `docs/` and dev files stay out of the package.
