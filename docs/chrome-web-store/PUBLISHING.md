# Публикация ProxyPilot в Chrome Web Store

Всё, что нужно, чтобы залить расширение в магазин. Готовые тексты — копируй как есть.

---

## 0. Что уже готово

- ✅ Manifest V3, `description`, `homepage_url`, иконки 16/32/48/128 в бренд-стиле.
- ✅ Сборка пакета: `sh scripts/build.sh` → `dist/chrome/proxypilot-<version>.zip` (manifest.json в корне).
- ✅ Экран «О разработчике» (фото, ссылки, донат). После публикации — вставить ссылку «Оценить» (см. §7).

## 1. Аккаунт и оплата

1. Аккаунт разработчика Chrome Web Store: https://chrome.google.com/webstore/devconsole
2. Разовый взнос **$5** (если ещё не оплачен).
3. Группа издателя — указать имя «Wildbots» (в настройках аккаунта, поле Publisher).

## 2. Сборка пакета

```sh
sh scripts/build.sh
# → dist/chrome/proxypilot-0.11.11.zip
```
Проверь, что в архиве `manifest.json` лежит в КОРНЕ (не внутри папки). Скрипт это гарантирует.
В пакет НЕ входят `data/`, `docs/`, тесты — только `extension/`.

## 3. Карточка магазина (готовый текст, RU)

**Название:** `ProxyPilot`

**Краткое описание** (summary, до 132 символов):
```
Открывай AI-сервисы и заблокированные сайты через свой прокси или подобранный бесплатный. Без VPN, по доменам.
```

**Подробное описание:**
```
ProxyPilot маршрутизирует только выбранные вами сайты через прокси — остальной трафик идёт напрямую. Удобно открывать AI-сервисы и другие гео-ограниченные ресурсы без полного VPN.

ВОЗМОЖНОСТИ
• Три источника прокси: свой прокси, свой пул с авто-ротацией, и бесплатный публичный пул.
• Бесплатный пул собирается из нескольких проверенных списков, фильтрует мёртвые и небезопасные адреса и сам подбирает рабочий.
• Маршрутизация по доменам: включаете нужные сервисы — только они идут через прокси.
• Поддержка HTTP, HTTPS, SOCKS5, SOCKS4 с авто-определением протокола и авторизацией.
• Светлая и тёмная тема, понятный статус «что сейчас работает».

ПОДДЕРЖИВАЕМЫЕ СЕРВИСЫ
AI-ассистенты, видео, музыка, дизайн и другие сервисы, недоступные из РФ со своей стороны.

ВАЖНО О БЕСПЛАТНОМ ПУЛЕ
Бесплатные публичные прокси крутят сторонние люди — не входите в важные аккаунты, пока трафик идёт через них. Для надёжности используйте свой прокси.

СООТВЕТСТВИЕ ЗАКОНУ
Расширение не маршрутизирует домены из реестра Роскомнадзора: если домен заблокирован в РФ, маршрутизация для него автоматически отключается (149-ФЗ).

Расширение бесплатное. Разработано в Wildbots — https://wildbots.ru/
```

**Категория:** Productivity (Продуктивность). Альтернатива: Tools.
**Язык карточки:** Русский (основной) + English (см. §3-EN ниже).

## 3-EN. Store listing — English locale

**Name:** `ProxyPilot`

**Summary** (≤132 chars):
```
Open AI services and blocked sites through your own proxy or a curated free one. No full VPN — routed per domain.
```

**Description:**
```
ProxyPilot routes only the sites you choose through a proxy — everything else goes direct. Great for opening AI services and other geo-restricted sites without a full VPN.

FEATURES
• Three proxy sources: your own proxy, your own pool with auto-rotation, and a free public pool.
• The free pool is built from several vetted lists, filters out dead and unsafe entries, and picks a working one for you.
• Domain-based routing: turn on the services you need — only those go through the proxy.
• HTTP, HTTPS, SOCKS5, SOCKS4 with protocol auto-detection and authentication.
• Light and dark theme, with a clear "what's active now" status.

ABOUT THE FREE POOL
Free public proxies are run by strangers — don't sign into important accounts while routed through them. Use your own proxy for reliability.

LEGAL COMPLIANCE
The extension does not route domains listed in Russia's Roskomnadzor registry: if a domain is blocked there, routing for it is disabled automatically (Russian law 149-FZ).

Free and open source. Made by Wildbots — https://wildbots.ru/
```

**Single purpose (EN):**
```
Route user-selected domains through a proxy server. The extension does not collect or transmit user data.
```

**Permission justifications (EN):**
- **proxy** — core function: configure the browser proxy (PAC on Chrome / `proxy.onRequest` on Firefox) to route selected domains.
- **storage** — store user settings (chosen services, own proxy/pool, theme) and a local cache of the free-proxy lists.
- **unlimitedStorage** — caches the Roskomnadzor registry of domains blocked in Russia (~17 MB, ~870,000 domains), which exceeds the default `chrome.storage.local` quota (~5–10 MB); without it the cache is truncated and the 149-FZ compliance check stops working.
- **webRequest** — detect proxy connection errors to auto-rotate to a working proxy.
- **webRequestAuthProvider** (Chrome only) — supply proxy username/password on auth challenges (authenticated proxies). On Firefox, auth is inline in the proxy descriptor.
- **tabs** — read the active tab's domain to show the correct toolbar icon state (proxied vs direct).
- **alarms** — periodically refresh the free-proxy list and re-check the RKN registry (daily).
- **host_permissions `<all_urls>`** — used only by the webRequest listeners (proxy auth + dead-proxy detection) across arbitrary user-routed domains, NOT for reading page content. `activeTab` doesn't fit — proxying runs in the background for all routed requests, not per click; specific hosts can't be listed because the user routes arbitrary domains. The extension does not read or modify page content and collects no user data.

**Data collection (EN):** none — declare no data collected. Reasoning identical to §6.

## 4. Графика для карточки

| Ассет | Размер | Статус |
|---|---|---|
| Иконка магазина | 128×128 PNG | ✅ `docs/chrome-web-store/icon/proxypilot-128.png` (цветная бренд-монограмма P, с 0.12.0 = `extension/icons/app-128.png`) |
| Скриншоты (1–5) | 1280×800 или 640×400 PNG | 📁 `docs/chrome-web-store/screenshots/` (сгенерированы, см. ниже) |
| Promo «маленькая плитка» | 440×280 PNG | 📁 `docs/chrome-web-store/screenshots/promo-440x280.png` |
| Promo «marquee» | 1400×560 JPEG/PNG без альфы | 📁 `docs/chrome-web-store/screenshots/promo-marquee-1400x560.jpg` |

Скриншоты показывают: главный экран, подбор бесплатного прокси (с конфетти-успехом),
настройки с якорем «Сейчас работает», экран «О разработчике».

## 5. Обоснования разрешений (Privacy practices → Permission justifications)

CWS спросит, зачем каждое разрешение. Готовые формулировки:

- **proxy** — основная функция: программно настраивать прокси Chrome (PAC-скрипт), чтобы направлять выбранные домены через прокси.
- **storage** — хранить настройки пользователя (выбранные сервисы, свой прокси/пул, тема) и кэш списка бесплатных прокси локально.
- **unlimitedStorage** — расширение кэширует локально реестр заблокированных в РФ доменов (Роскомнадзор) — около 17 МБ (~870 000 доменов). Это превышает стандартный лимит `chrome.storage.local` (~5–10 МБ), из-за чего без `unlimitedStorage` кэш обрезается и проверка соответствия 149-ФЗ перестаёт работать. Разрешение снимает лимит, чтобы надёжно хранить полный реестр офлайн.
- **webRequest** — отслеживать ошибки соединения с прокси, чтобы автоматически переключаться на следующий рабочий прокси.
- **webRequestAuthProvider** — подставлять логин/пароль прокси при запросе авторизации (прокси с аутентификацией).
- **tabs** — определять домен активной вкладки, чтобы показывать корректный статус иконки (через прокси / напрямую) для текущего сайта.
- **alarms** — периодически обновлять список бесплатных прокси и проверять реестр РКН (раз в сутки).
- **host_permissions `<all_urls>`** — нужен НЕ для проксирования (PAC-маршрутизация через `chrome.proxy` host-доступа не требует), а для двух webRequest-слушателей: `onAuthRequired` (подстановка логина/пароля прокси с авторизацией) и `onErrorOccurred` (определение отказа прокси и авто-переключение на рабочий). Пользователь может маршрутизировать произвольные домены, поэтому слушатели должны работать на любом URL. `activeTab` не подходит — проксирование идёт в фоне для всех маршрутизируемых запросов, а не по клику на вкладке; перечислить конкретные хосты нельзя — список маршрутизируемых доменов задаёт пользователь и заранее неизвестен. Расширение НЕ читает и НЕ изменяет содержимое страниц и не собирает данные пользователя.

> **Предупреждение CWS «Разрешения на доступ к широкому кругу хостов».** Это не отказ,
> а уведомление о более долгой ручной проверке. Для прокси-расширения `<all_urls>`
> обоснован (формулировка выше). Подавать как есть; `activeTab` функционально не
> заменяет фоновую логику прокси. Детальная проверка — одноразовая задержка.

**Единственное назначение (Single purpose):**
```
Маршрутизация выбранных пользователем доменов через прокси-сервер. Расширение не собирает и не передаёт данные пользователя.
```

**Remote code:** Нет (всё в пакете; внешне тянутся только публичные списки прокси и реестр РКН как данные, не как исполняемый код).

## 6. Раскрытие данных (Data usage / «Сбор данных»)

Принцип Google: «сбор» = передача данных С устройства пользователя (разработчику или
третьим лицам). ProxyPilot ничего не передаёт: настройки и логин/пароль прокси хранятся
только локально; креды уходят лишь на сам прокси пользователя. → **в форме «Сбор данных»
не отмечать ни одну категорию.**

Пояснения по спорным пунктам (если спросят):
- **Данные для аутентификации** — логин/пароль прокси вводит сам пользователь, хранятся
  локально, не передаются разработчику/третьим лицам → не «сбор».
- **Местоположение / IP** — IP пользователя не собирается; страна/IP относятся к
  прокси-серверу, не к человеку.
- **История веб-поиска** — не накапливается; читается только текущий домен вкладки для
  иконки статуса, без сохранения.
- **Действия пользователей** — `webRequest` ловит только ошибки соединения с прокси (для
  авто-ротации), не логирует клики/трафик.
- **Содержимое сайтов** — не читается и не изменяется.

Три подтверждения под списком — все «да»:
1. Не продаю/не передаю данные третьим лицам.
2. Не использую данные для целей вне основного назначения.
3. Не использую для оценки кредитоспособности/займов.

- **Privacy policy URL** — обязателен. Размести `docs/chrome-web-store/privacy-policy.md` как страницу на `https://wildbots.ru/proxypilot/privacy` (или любой URL) и укажи его в форме.

## 7. После публикации

1. Скопируй ссылку вида `https://chromewebstore.google.com/detail/<id>` из дев-консоли.
2. В `extension/popup/popup.html` найди блок «Оценить» (id `about-rate`) и замени тизер на рабочую кнопку:
   ```html
   <a class="about-cta about-cta-rate" id="about-rate"
      href="https://chromewebstore.google.com/detail/<ID>/reviews"
      target="_blank" rel="noopener noreferrer">⭐ Оценить расширение</a>
   ```
   (добавь стиль `.about-cta-rate` по образцу `.about-cta-primary`, либо переиспользуй его класс).
3. Подними версию, собери пакет заново, выложи обновление.

## 8. Чеклист перед «Submit for review»

- [ ] `sh scripts/build.sh` собран свежий zip, версия совпадает с manifest.
- [ ] Название, краткое и подробное описание вставлены (§3).
- [ ] Категория и язык выбраны.
- [ ] Иконка 128 и минимум 1 скриншот 1280×800 загружены (§4).
- [ ] Обоснования всех разрешений заполнены (§5).
- [ ] Single purpose заполнен (§5).
- [ ] Data usage отмечен + Privacy policy URL указан (§6).
- [ ] Контактный email разработчика подтверждён в аккаунте.
