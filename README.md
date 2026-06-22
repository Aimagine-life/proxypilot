<div align="center">

<img src="docs/chrome-web-store/icon/proxypilot-128.png" width="88" alt="ProxyPilot" />

# ProxyPilot

### Proxy Toggle & Smart Routing Tool

Маршрутизирует **только выбранные домены** через твой прокси или подобранный
бесплатный пул — остальной трафик идёт напрямую. Точечно, а не «VPN на весь
браузер». Без аккаунта, без слежки, всё локально.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/gmbihijfnafhpafknokdnkkafbbkbehj?logo=googlechrome&logoColor=white&label=Chrome%20Web%20Store&color=4285F4)](https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj)
[![Firefox Add-ons](https://img.shields.io/amo/v/proxypilot?logo=firefoxbrowser&logoColor=white&label=Firefox%20Add-ons&color=FF7139)](https://addons.mozilla.org/firefox/addon/proxypilot/)
[![License: MIT](https://img.shields.io/github/license/Aimagine-life/proxypilot?color=brightgreen)](LICENSE)

**Русский · [English](#english)**

<br/>

<a href="https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj"><img src="https://img.shields.io/badge/Chrome%20Web%20Store-Установить-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" height="46" alt="Установить из Chrome Web Store" /></a>
&nbsp;
<a href="https://addons.mozilla.org/firefox/addon/proxypilot/"><img src="https://img.shields.io/badge/Firefox-Установить-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white" height="46" alt="Установить для Firefox" /></a>

<br/><br/>

<a href="https://www.producthunt.com/products/proxypilot?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-proxypilot" target="_blank" rel="noopener noreferrer"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1178035&theme=light&t=1782129789279" alt="ProxyPilot — Use any AI from anywhere, no VPN, no signup | Product Hunt" width="250" height="54" /></a>

<br/><br/>

<img src="docs/chrome-web-store/screenshots/promo-marquee-1400x560.jpg" alt="ProxyPilot — переключение прокси и умная маршрутизация" width="100%" />

</div>

---

> ## ⚠️ Важно перед установкой
>
> Если у тебя уже стоят **другие прокси-расширения** — **Proxy SwitchyOmega**, FoxyProxy, VPN-расширения и любые управляющие прокси — **отключи или удали их**.
>
> Chrome отдаёт управление прокси только **одному** расширению. Если их несколько — будет конфликт: сайты перестают открываться, хотя прокси «подключён».
>
> **В Opera** дополнительно отключи **встроенный VPN** (Настройки → Конфиденциальность → VPN) — он тоже управляет трафиком и конфликтует.
>
> 💬 *Реальный случай пользователя: «был конфликт с другим расширением — Proxy SwitchyOmega 3, отключил его и всё гуд!»*

---

## Что умеет

- 🎯 **Точечная маршрутизация** — через прокси идут только выбранные домены, остальной трафик напрямую. Это не «VPN на весь браузер».
- 🤖 **35+ готовых сервисов** в один клик — включаешь нужные пресеты, их домены сразу маршрутизируются.
- 🔌 **Три источника прокси** — свой прокси, свой пул с авто-ротацией или бесплатный подобранный пул.
- ⚡ **Умный бесплатный пул** — сам находит быстрый рабочий прокси, отсеивает медленные, держит запас для мгновенной замены.
- 🔒 **Без слежки и аккаунта** — ничего не собирает, всё хранится и работает локально.
- 🧩 **HTTP / HTTPS / SOCKS5 / SOCKS4** с автоопределением протокола и авторизацией.
- 🛡 **Список блокировки** — домены из списка блокировки расширение не маршрутизирует; проверка при запуске и каждые 24 часа.

## Как выглядит

| Главный экран | Бесплатный пул | Активный источник |
|:---:|:---:|:---:|
| <img src="docs/chrome-web-store/screenshots/01-main.png" alt="Главный экран" /> | <img src="docs/chrome-web-store/screenshots/02-free-pool.png" alt="Бесплатный пул" /> | <img src="docs/chrome-web-store/screenshots/03-active-source.png" alt="Активный источник" /> |

## Установка

**Проще всего — из магазина:**

- 🟦 **Chrome / Edge / Brave** → [Chrome Web Store](https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj)
- 🔴 **Opera** → тот же [Chrome Web Store](https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj) через аддон **«Install Chrome Extensions»** (Opera на Chromium)
- 🟧 **Firefox** → [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/proxypilot/)

**Вручную** (для разработки): `chrome://extensions` → «Режим разработчика» → «Загрузить распакованное» → папка `extension/`. Подробнее (Chrome и Firefox) — в [INSTALL.md](INSTALL.md).

## Настройка прокси

Три источника — в **Настройки → Источник прокси**:

- **Свой** — один прокси. Формат любой: `host:port:user:pass`, `socks5://user:pass@host:port`, `http://host:port`. Протокол определяется автоматически.
- **Свой пул** — список своих прокси, по строке. При отказе текущего плагин сам берёт следующий.
- **Бесплатный пул** — расширение тянет несколько публичных списков, фильтрует и проверяет кандидатов, находит живой и быстрый. Кнопка **↻ Сменить** берёт другой.

> ⚠️ **Бесплатные прокси публичные и не доверенные.** Не входи в важные аккаунты, пока трафик идёт через них — вход почти наверняка пометят как подозрительный. Для надёжности используй свой прокси. В popup есть явный жёлтый баннер, когда бесплатный пул активен.

## Поддерживаемые сервисы

Пресеты сгруппированы по категориям — AI-ассистенты и инструменты, видео, музыка, дизайн, веб и работа. Включаешь нужные одним кликом, домены пресета сразу попадают в маршрутизацию.

Можно добавлять и **свои домены**. Google Auth (`accounts.google.com`) подключается автоматически при включении любого Google-AI сервиса.

> **⚠️ Часть сервисов ограничивает доступ по аккаунту/карте, не только по IP.** Прокси откроет сайт, но для полного доступа могут понадобиться зарубежный аккаунт и/или карта. Стриминговые сервисы детектят датацентровые прокси — надёжно работают только через резидентный/мобильный прокси.

## Список блокировки

Расширение проверяет маршрутизируемые домены по списку блокировки. Если домен в списке — маршрутизация для него автоматически отключается. Проверка выполняется при запуске и каждые 24 часа.

## Технологии

Manifest V3, чистый JS, без зависимостей и сборки. Тесты: `npm test`. Релиз — по git-тегу `v*` (авто-публикация в оба стора).

<br/>

---

<div align="center">

<a name="english"></a>
<img src="docs/chrome-web-store/icon/proxypilot-128.png" width="88" alt="ProxyPilot" />

# ProxyPilot

### Proxy Toggle & Smart Routing Tool

Routes **only the domains you pick** through your own proxy — or a curated free
pool. Everything else goes direct. Per-domain, not a "whole-browser VPN". No
account, no tracking, all local.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/gmbihijfnafhpafknokdnkkafbbkbehj?logo=googlechrome&logoColor=white&label=Chrome%20Web%20Store&color=4285F4)](https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj)
[![Firefox Add-ons](https://img.shields.io/amo/v/proxypilot?logo=firefoxbrowser&logoColor=white&label=Firefox%20Add-ons&color=FF7139)](https://addons.mozilla.org/firefox/addon/proxypilot/)
[![License: MIT](https://img.shields.io/github/license/Aimagine-life/proxypilot?color=brightgreen)](LICENSE)

**[Русский](#proxypilot) · English**

<br/>

<a href="https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj"><img src="https://img.shields.io/badge/Chrome%20Web%20Store-Install-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" height="46" alt="Available in the Chrome Web Store" /></a>
&nbsp;
<a href="https://addons.mozilla.org/firefox/addon/proxypilot/"><img src="https://img.shields.io/badge/Firefox-Install-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white" height="46" alt="Get the Firefox Add-on" /></a>

<br/><br/>

<a href="https://www.producthunt.com/products/proxypilot?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-proxypilot" target="_blank" rel="noopener noreferrer"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1178035&theme=light&t=1782129789279" alt="ProxyPilot — Use any AI from anywhere, no VPN, no signup | Product Hunt" width="250" height="54" /></a>

<br/><br/>

<img src="docs/chrome-web-store/screenshots/en/promo-marquee.jpg" alt="ProxyPilot — proxy toggle & smart routing" width="100%" />

</div>

---

> ## ⚠️ Before you install
>
> If you already use **other proxy extensions** — **Proxy SwitchyOmega**, FoxyProxy, VPN add-ons, anything that controls the proxy — **disable or remove them**.
>
> Chrome hands proxy control to only **one** extension. With several installed they conflict: sites stop loading even though the proxy looks "connected".
>
> **In Opera**, also turn off the **built-in VPN** (Settings → Privacy → VPN) — it controls traffic too and will conflict.
>
> 💬 *Real user report: "there was a conflict with another extension — Proxy SwitchyOmega 3 — disabled it and all good!"*

---

## Features

- 🎯 **Per-domain routing** — only the domains you pick go through the proxy, the rest stays direct. Not a "whole-browser VPN".
- 🤖 **35+ ready services** in one click — enable the presets you need and their domains route immediately.
- 🔌 **Three proxy sources** — your own proxy, your own pool with auto-rotation, or a curated free pool.
- ⚡ **Smart free pool** — finds a fast working proxy, skips slow ones, keeps a warm standby for instant switching.
- 🔒 **No tracking, no account** — runs locally, collects nothing.
- 🧩 **HTTP / HTTPS / SOCKS5 / SOCKS4** with auto-detection and auth.
- 🛡 **Blocklist** — domains on the blocklist are never routed; checked on startup and every 24 hours.

## Screenshots

| Main screen | Free pool |
|:---:|:---:|
| <img src="docs/chrome-web-store/screenshots/en/01-main.png" alt="Main screen" /> | <img src="docs/chrome-web-store/screenshots/en/02-free-pool.png" alt="Free pool" /> |

## Install

- 🟦 **Chrome / Edge / Brave** → [Chrome Web Store](https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj)
- 🔴 **Opera** → same [Chrome Web Store](https://chromewebstore.google.com/detail/proxypilot/gmbihijfnafhpafknokdnkkafbbkbehj) via the **"Install Chrome Extensions"** add-on (Opera is Chromium-based)
- 🟧 **Firefox** → [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/proxypilot/)

Manual install (development): `chrome://extensions` → Developer mode → Load unpacked → `extension/` folder. Details (Chrome & Firefox) in [INSTALL.md](INSTALL.md).

## Proxy setup

Three sources under **Settings → Proxy source**:

- **Your own** — a single proxy. Any format: `host:port:user:pass`, `socks5://user:pass@host:port`, `http://host:port`. Protocol auto-detected.
- **Own pool** — your own list, one per line. If the current one fails, the extension picks the next.
- **Free pool** — fetches several public lists, filters and validates candidates, finds a fast live one. **↻ Rotate** grabs another.

> ⚠️ **Free proxies are public and untrusted.** Don't sign into important accounts while routed through them — the sign-in will likely be flagged. Use your own proxy for reliability. The popup shows a clear warning banner when the free pool is active.

## Supported services

Presets are grouped by category — AI assistants and tools, video, music, design, web and work. Toggle the ones you need and their domains route instantly.

You can also add **custom domains**. Google Auth (`accounts.google.com`) is auto-routed when any Google-AI service is on.

> **⚠️ Some services gate by account/card, not just IP.** The proxy opens the site, but full access may also need a foreign account and/or card. Streaming services detect datacenter proxies — reliable only via a residential/mobile proxy.

## Blocklist

The extension checks routed domains against its blocklist. If a domain is on the list, routing for it is disabled automatically. Checks run on startup and every 24 hours.

## Tech

Manifest V3, vanilla JS, no dependencies, no build step. Tests: `npm test`. Releases ship on a `v*` git tag (auto-published to both stores).
