# Gemini Unblock

Chromium extension that routes AI services and other geo-restricted sites through your own proxy.

## Install

1. Download or clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `extension/` folder

## Setup

Two sources are available — pick one in **Settings → Proxy source**.

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
2. The extension fetches the public [Proxifly](https://github.com/proxifly/free-proxy-list) list, filters out transparent / unknown-country / `RU·BY·CN·IR` entries, sorts by score, and validates candidates against Google's `generate_204` until one works
3. Live progress shows `Checking N/M · host:port`; if everything's dead, the full pool count is reported
4. Click **↻ Rotate** to drop the current pick and find another

**Important:** free proxies are operated by random people. Avoid logging into Google / accounts you care about while routed through them — Google will likely flag the sign-in. The popup shows an explicit warning banner when Free pool is active with any AI service enabled.

UI language: Russian (`<html lang="ru">`). Brand and preset names stay in English.

## Supported services

| Service | Domains |
|---|---|
| Gemini | gemini.google.com |
| AI Studio | aistudio.google.com |
| NotebookLM | notebooklm.google.com |
| Google Labs | labs.google |
| ChatGPT | chatgpt.com, chat.openai.com |
| Claude | claude.ai |
| Perplexity | perplexity.ai |
| Grok | grok.com, x.ai |
| ElevenLabs | elevenlabs.io |
| YouTube | youtube.com, youtu.be, googlevideo.com |

Custom domains can also be added — they're checked against the RKN registry before being accepted. RKN-blocked domains are rejected.

Google Auth (accounts.google.com) is auto-routed when any Google AI service is enabled.

## RKN compliance

The extension checks whether routed domains are blocked by Roskomnadzor. If a domain is in the RKN registry, routing is automatically disabled to comply with Russian law (149-FZ). Checks run on startup and every 24 hours.

## Proxy protocols

HTTP, HTTPS, SOCKS5, SOCKS4. Auto-detection supported. Authentication supported.

## Tech

Manifest V3, vanilla JS, no dependencies, no build step. Tests: `npm test`.

---

# Gemini Unblock (RU)

Расширение для Chromium, которое направляет AI-сервисы и другие гео-ограниченные сайты через ваш прокси.

## Установка

1. Скачайте или клонируйте репозиторий
2. Откройте `chrome://extensions`
3. Включите **Режим разработчика**
4. Нажмите **Загрузить распакованное** → выберите папку `extension/`

## Настройка

Доступны два источника прокси — выбирай в **Настройки → Источник прокси**.

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
2. Расширение тянет публичный список [Proxifly](https://github.com/proxifly/free-proxy-list), отфильтровывает `transparent`-анонимность, `country: ZZ` и страны `RU·BY·CN·IR`, сортирует по `score`, и последовательно проверяет кандидатов через Google `generate_204` пока не найдёт живой
3. В реальном времени показывается прогресс: `Проверка N/M · host:port`. Если ничего живого не нашлось — сообщение с количеством проверенных
4. Кнопка **↻ Сменить** помечает текущий как мёртвый и ищет другой

**Важно:** бесплатные прокси крутят случайные люди. Не входи в Google-аккаунт и другие важные сервисы, когда трафик идёт через них — Google почти наверняка пометит вход как подозрительный. В popup есть явный жёлтый баннер когда `Бесплатный пул` активен вместе с любым AI-сервисом.

UI расширения на русском (`<html lang="ru">`). Бренд и имена пресетов оставлены по-английски.

## Поддерживаемые сервисы

| Сервис | Домены |
|---|---|
| Gemini | gemini.google.com |
| AI Studio | aistudio.google.com |
| NotebookLM | notebooklm.google.com |
| Google Labs | labs.google |
| ChatGPT | chatgpt.com, chat.openai.com |
| Claude | claude.ai |
| Perplexity | perplexity.ai |
| Grok | grok.com, x.ai |
| ElevenLabs | elevenlabs.io |
| YouTube | youtube.com, youtu.be, googlevideo.com |

Также можно добавить свои домены — они проверяются в реестре РКН перед добавлением. Заблокированные Роскомнадзором домены не принимаются.

Google Auth (accounts.google.com) подключается автоматически при включении любого Google AI сервиса.

## Соответствие закону

Расширение проверяет, не заблокированы ли маршрутизируемые домены Роскомнадзором. Если домен находится в реестре РКН, маршрутизация автоматически отключается в соответствии с законодательством РФ (149-ФЗ). Проверка выполняется при запуске и каждые 24 часа.

## Протоколы

HTTP, HTTPS, SOCKS5, SOCKS4. Автоопределение протокола. Аутентификация поддерживается.

## Технологии

Manifest V3, чистый JS, без зависимостей, без сборки. Тесты: `npm test`.
