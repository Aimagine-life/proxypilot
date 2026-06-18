<div align="center">

<img src="docs/chrome-web-store/icon/proxypilot-128.png" width="88" alt="ProxyPilot" />

# ProxyPilot

### Открывай AI-сервисы и заблокированные сайты — без VPN

Маршрутизация **только выбранных доменов** через твой прокси или подобранный бесплатный.
Остальной трафик идёт напрямую. Без аккаунта, без слежки.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/gmbihijfnafhpafknokdnkkafbbkbehj?logo=googlechrome&logoColor=white&label=Chrome%20Web%20Store&color=4285F4)](https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj)
[![Firefox Add-ons](https://img.shields.io/amo/v/proxypilot?logo=firefoxbrowser&logoColor=white&label=Firefox%20Add-ons&color=FF7139)](https://addons.mozilla.org/firefox/addon/proxypilot/)
[![License: MIT](https://img.shields.io/github/license/Aimagine-life/proxypilot?color=brightgreen)](LICENSE)

**Русский · [English](#english)**

<br/>

<a href="https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj"><img src="https://storage.googleapis.com/web-dev-uploads/image/WlD8wC6g8khYWPJUsQceQkhXSlv1/UV4C4ybeBTsZt43U4xis.png" height="58" alt="Установить из Chrome Web Store" /></a>
&nbsp;
<a href="https://addons.mozilla.org/firefox/addon/proxypilot/"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" height="58" alt="Установить для Firefox" /></a>

<br/><br/>

<img src="docs/chrome-web-store/screenshots/promo-marquee-1400x560.jpg" alt="ProxyPilot — открывай AI-сервисы без VPN" width="100%" />

</div>

---

> ## ⚠️ Важно перед установкой
>
> Если у тебя уже стоят **другие прокси-расширения** — **Proxy SwitchyOmega**, FoxyProxy, VPN-расширения и любые управляющие прокси — **отключи или удали их**.
>
> Chrome отдаёт управление прокси только **одному** расширению. Если их несколько — будет конфликт: сайты перестают открываться, хотя прокси «подключён».
>
> 💬 *Реальный случай пользователя: «был конфликт с другим расширением — Proxy SwitchyOmega 3, отключил его и всё gud!»*

---

## Что умеет

- 🎯 **Точечная маршрутизация** — через прокси идут только выбранные сервисы/домены, остальной трафик напрямую. Это не «VPN на весь браузер».
- 🤖 **40+ готовых сервисов** в один клик — Gemini, ChatGPT, Claude, Perplexity, YouTube, Spotify и другие.
- 🔌 **Три источника прокси** — свой прокси, свой пул с авто-ротацией, или бесплатный подобранный пул.
- ⚡ **Умный бесплатный пул** — сам находит быстрый рабочий прокси, отсеивает медленные, держит запас для мгновенной замены.
- 🔒 **Без слежки и аккаунта** — ничего не собирает, работает локально.
- 🧩 **HTTP / HTTPS / SOCKS5 / SOCKS4** с автоопределением и авторизацией.

## Как выглядит

| Главный экран | Бесплатный пул | Активный источник |
|:---:|:---:|:---:|
| <img src="docs/chrome-web-store/screenshots/01-main.png" alt="Главный экран" /> | <img src="docs/chrome-web-store/screenshots/02-free-pool.png" alt="Бесплатный пул" /> | <img src="docs/chrome-web-store/screenshots/03-active-source.png" alt="Активный источник" /> |

## Установка

**Проще всего — из магазина:**

- 🟦 **Chrome / Edge / Brave** → [Chrome Web Store](https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj)
- 🟧 **Firefox** → [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/proxypilot/)

**Вручную** (для разработки): `chrome://extensions` → «Режим разработчика» → «Загрузить распакованное» → папка `extension/`. Подробнее (Chrome и Firefox) — в [INSTALL.md](INSTALL.md).

## Настройка прокси

Три источника — в **Настройки → Источник прокси**:

- **Свой** — один прокси. Формат любой: `host:port:user:pass`, `socks5://user:pass@host:port`, `http://host:port`. Протокол определяется автоматически.
- **Свой пул** — список своих прокси, по строке. При отказе текущего плагин сам берёт следующий.
- **Бесплатный пул** — расширение тянет несколько публичных списков, фильтрует и проверяет кандидатов, находит живой и быстрый. Кнопка **↻ Сменить** берёт другой.

> ⚠️ **Бесплатные прокси публичные и не доверенные.** Не входи в Google и важные аккаунты, пока трафик идёт через них — вход почти наверняка пометят как подозрительный. В popup есть явный жёлтый баннер, когда бесплатный пул активен с AI-сервисом.

## Поддерживаемые сервисы

**AI:** Gemini, AI Studio, NotebookLM, Google Labs, ChatGPT, Claude, Perplexity, Grok, MS Copilot, Poe, JetBrains AI, GitHub Copilot, Suno, Sora, ElevenLabs
**Видео:** YouTube, Netflix, Disney+, Max, Prime Video, Apple TV+, Paramount+, Peacock, Hulu, Crunchyroll, MUBI
**Музыка:** Spotify, Deezer, Tidal · **Прочее:** Figma, Notion, Slack, Shopify и др.

Можно добавлять свои домены. Google Auth (`accounts.google.com`) подключается автоматически при включении любого Google-AI сервиса.

> **⚠️ Часть сервисов блокирует по аккаунту/карте, не только по IP.** Прокси откроет сайт, но для полного доступа нужны не-РФ аккаунт и/или карта. Стриминг (Netflix, Disney+ и т.п.) детектит датацентровые прокси — надёжно работает только через резидентный/мобильный прокси.

## Соответствие закону (РФ)

Расширение проверяет маршрутизируемые домены по реестру Роскомнадзора. Если домен в реестре РКН — маршрутизация автоматически отключается (149-ФЗ). Проверка при запуске и каждые 24 часа.

## Технологии

Manifest V3, чистый JS, без зависимостей и сборки. Тесты: `npm test`. Релиз — по git-тегу `v*` (авто-публикация в оба стора).

<br/>

---

<div align="center">

<a name="english"></a>
<img src="docs/chrome-web-store/icon/proxypilot-128.png" width="88" alt="ProxyPilot" />

# ProxyPilot

### Reach AI services and geo-blocked sites — without a VPN

Routes **only the domains you pick** through your own proxy — or a curated free pool.
Everything else goes direct. No account, no tracking.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/gmbihijfnafhpafknokdnkkafbbkbehj?logo=googlechrome&logoColor=white&label=Chrome%20Web%20Store&color=4285F4)](https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj)
[![Firefox Add-ons](https://img.shields.io/amo/v/proxypilot?logo=firefoxbrowser&logoColor=white&label=Firefox%20Add-ons&color=FF7139)](https://addons.mozilla.org/firefox/addon/proxypilot/)
[![License: MIT](https://img.shields.io/github/license/Aimagine-life/proxypilot?color=brightgreen)](LICENSE)

**[Русский](#proxypilot) · English**

<br/>

<a href="https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj"><img src="https://storage.googleapis.com/web-dev-uploads/image/WlD8wC6g8khYWPJUsQceQkhXSlv1/UV4C4ybeBTsZt43U4xis.png" height="58" alt="Available in the Chrome Web Store" /></a>
&nbsp;
<a href="https://addons.mozilla.org/firefox/addon/proxypilot/"><img src="https://blog.mozilla.org/addons/files/2020/04/get-the-addon-fx-apr-2020.svg" height="58" alt="Get the Firefox Add-on" /></a>

<br/><br/>

<img src="docs/chrome-web-store/screenshots/en/promo-marquee.jpg" alt="ProxyPilot — reach blocked AI, video & more" width="100%" />

</div>

---

> ## ⚠️ Before you install
>
> If you already use **other proxy extensions** — **Proxy SwitchyOmega**, FoxyProxy, VPN add-ons, anything that controls the proxy — **disable or remove them**.
>
> Chrome hands proxy control to only **one** extension. With several installed they conflict: sites stop loading even though the proxy looks "connected".
>
> 💬 *Real user report: "there was a conflict with another extension — Proxy SwitchyOmega 3 — disabled it and all good!"*

---

## Features

- 🎯 **Per-domain routing** — only the services/domains you pick go through the proxy, the rest stays direct. Not a "whole-browser VPN".
- 🤖 **40+ ready services** in one click — Gemini, ChatGPT, Claude, Perplexity, YouTube, Spotify and more.
- 🔌 **Three proxy sources** — your own proxy, your own pool with auto-rotation, or a curated free pool.
- ⚡ **Smart free pool** — finds a fast working proxy, skips slow ones, keeps a warm standby for instant switching.
- 🔒 **No tracking, no account** — runs locally, collects nothing.
- 🧩 **HTTP / HTTPS / SOCKS5 / SOCKS4** with auto-detection and auth.

## Screenshots

| Main screen | Free pool |
|:---:|:---:|
| <img src="docs/chrome-web-store/screenshots/en/01-main.png" alt="Main screen" /> | <img src="docs/chrome-web-store/screenshots/en/02-free-pool.png" alt="Free pool" /> |

## Install

- 🟦 **Chrome / Edge / Brave** → [Chrome Web Store](https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj)
- 🟧 **Firefox** → [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/proxypilot/)

Manual install (development): `chrome://extensions` → Developer mode → Load unpacked → `extension/` folder. Details (Chrome & Firefox) in [INSTALL.md](INSTALL.md).

## Proxy setup

Three sources under **Settings → Proxy source**:

- **Your own** — a single proxy. Any format: `host:port:user:pass`, `socks5://user:pass@host:port`, `http://host:port`. Protocol auto-detected.
- **Own pool** — your own list, one per line. If the current one fails, the extension picks the next.
- **Free pool** — fetches several public lists, filters and validates candidates, finds a fast live one. **↻ Rotate** grabs another.

> ⚠️ **Free proxies are public and untrusted.** Don't sign into Google or important accounts while routed through them — the sign-in will likely be flagged. The popup shows a clear warning banner when the free pool is active with an AI service.

## Supported services

**AI:** Gemini, AI Studio, NotebookLM, Google Labs, ChatGPT, Claude, Perplexity, Grok, MS Copilot, Poe, JetBrains AI, GitHub Copilot, Suno, Sora, ElevenLabs
**Video:** YouTube, Netflix, Disney+, Max, Prime Video, Apple TV+, Paramount+, Peacock, Hulu, Crunchyroll, MUBI
**Music:** Spotify, Deezer, Tidal · **More:** Figma, Notion, Slack, Shopify, etc.

Custom domains can be added too. Google Auth (`accounts.google.com`) is auto-routed when any Google-AI service is on.

> **⚠️ Some services gate by account/card, not just IP.** The proxy opens the site, but full access also needs a non-RU account and/or card. Streaming (Netflix, Disney+, etc.) detects datacenter proxies — reliable only via a residential/mobile proxy.

## Legal compliance (Russia)

The extension checks routed domains against the Roskomnadzor (RKN) registry. If a domain is listed, routing is automatically disabled to comply with Russian law (149-FZ). Checks run on startup and every 24 hours.

## Tech

Manifest V3, vanilla JS, no dependencies, no build step. Tests: `npm test`. Releases ship on a `v*` git tag (auto-published to both stores).
