# Крипто-донаты (TON) через экран «Поддержать» — дизайн

- **Дата:** 2026-06-18
- **Проект:** ProxyPilot (gemini-unblock), браузерное расширение, Manifest V3
- **Текущая версия:** 0.13.1 → **0.14.0** (новая фича)
- **Статус:** одобрено пользователем

## 1. Цель

Расширение уже принимает донаты через Yoomoney (карты РФ). После перевода UI на
английский нужна международная опция — **крипто-донаты на встроенный кошелёк
Telegram (`@wallet`, сеть TON)**. Принимаем **USDT (TON) и TON на один TON-адрес**.

В браузерном расширении крипто-донат = показать адрес + QR + кнопку «Копировать»
(автоподтверждения платежа нет — как и у текущей Yoomoney-ссылки).

## 2. Принятые решения

| Развилка | Решение |
|---|---|
| Валюта/сеть | USDT (TON) + TON на **один** TON-адрес |
| Размещение | Отдельный экран `#screen-support` с двумя способами (Карта/Yoomoney + Крипта) |
| QR-код | **Статичный PNG** (`popup/qr-ton.png`), без JS-зависимостей и CSP-рисков |
| Кнопка «Назад» | Всегда на main (как `back-from-about`) |
| EN-подпись карты | «Bank card (Russia)» — чтобы иностранец сразу шёл в крипту |

## 3. Реквизиты

- **TON-адрес:** `UQCBazZZbctu3IEMdPp5H8pKtQhf9raykndGUYo7hQsF5yGo`
- Адрес публичный (не секрет), хранится как текст в HTML — **единственный источник**.
- QR (`popup/qr-ton.png`) генерируется из этого же адреса один раз на этапе реализации.

## 4. Архитектура

Добавляется **четвёртый экран** `#screen-support` по существующему паттерну
`#screen-about` (`<section id="screen-*" class="screen" hidden>` + show/hide через
`.hidden` + `animateScreen()`).

### Точки входа (заменяют прямые ссылки на Yoomoney)

| Элемент | Сейчас | Станет |
|---|---|---|
| Баннер-кнопка `#donate-banner-link` ([popup.html:44](../../../extension/popup/popup.html)) | `<a href="yoomoney…">` | `<button>` → `showSupport()` + `dismissed=true` |
| Footer `.footer-donate` ([popup.html:69](../../../extension/popup/popup.html)) | `<a href="yoomoney…">` | `<button>`/`<a>` → `showSupport()` |
| About `#about-donate` ([popup.html:245](../../../extension/popup/popup.html)) | `<a href="yoomoney…">` | `<button>`/`<a>` → `showSupport()` |

Yoomoney не удаляется — становится одним из двух способов **внутри** экрана.

### Содержимое `#screen-support`

```
┌──────────────────────────────────────────┐
│ ←   Поддержать проект                     │
├──────────────────────────────────────────┤
│  💛 Спасибо, что пользуешься ProxyPilot.   │
│                                            │
│  ┌─ Банковская карта ────────────────┐    │
│  │  Картой РФ через ЮMoney            │    │
│  │  [  💳 Перейти к оплате  ↗  ]      │    │
│  └────────────────────────────────────┘    │
│  ┌─ Криптовалюта ────────────────────┐    │
│  │  USDT или TON · сеть TON           │    │
│  │        ┌──────────────┐            │    │
│  │        │  ▓▓ QR PNG ▓▓ │            │    │
│  │        └──────────────┘            │    │
│  │  UQCB…F5yGo        [ Копировать ]  │    │
│  │  Через Telegram → @wallet.          │    │
│  └────────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

- **Карта/ЮMoney:** `<a href="https://yoomoney.ru/to/410011076392857" target="_blank" rel="noopener noreferrer">`.
- **Крипта:** `<img src="qr-ton.png">`, адрес в `<code id="ton-address">`, кнопка
  «Копировать» → `navigator.clipboard.writeText(document.getElementById('ton-address').textContent)`,
  на ~1.5 c меняет подпись на «Скопировано ✓», затем возвращает.

## 5. Изменения по файлам

| Файл | Изменение |
|---|---|
| `extension/popup/popup.html` | Новый `<section id="screen-support">`; 3 точки входа переключить на навигацию |
| `extension/popup/popup.js` | Добавить `'support'` в массив `screens` ([popup.js:103](../../../extension/popup/popup.js)); функция `showSupport()` (по образцу `showAbout()` [popup.js:143-147](../../../extension/popup/popup.js)); обработчики на 3 кнопки входа + `#back-from-support` → `showMain()`; обработчик кнопки «Копировать»; баннер по-прежнему ставит `dismissed=true` |
| `extension/popup/popup.css` | Блок `.support-*`: 2 карточки способов, рамка QR, моноширинный адрес с переносом; на текущих CSS-переменных (light/dark), амбер-акцент как `.donate-*` |
| `extension/_locales/ru/messages.json` | Новые ключи (см. §6) |
| `extension/_locales/en/messages.json` | Новые ключи (см. §6) |
| `extension/popup/qr-ton.png` | **Новый файл** — QR TON-адреса |
| `extension/manifest.json` | `version` → `0.14.0` |
| `package.json` | `version` → `0.14.0` |
| `CHANGELOG.md` | Запись 0.14.0 на RU и EN |

## 6. Локализация (новые ключи)

| Ключ | RU | EN |
|---|---|---|
| `support_title` | Поддержать проект | Support the project |
| `support_intro` | Спасибо, что пользуешься ProxyPilot. Поддержка помогает развивать проект. | Thanks for using ProxyPilot. Your support helps keep the project going. |
| `support_method_card_label` | Банковская карта | Bank card (Russia) |
| `support_method_card_sub` | Картой РФ через ЮMoney | Russian cards via YooMoney |
| `support_card_btn` | 💳 Перейти к оплате | 💳 Pay |
| `support_method_crypto_label` | Криптовалюта | Cryptocurrency |
| `support_crypto_sub` | USDT или TON · сеть TON | USDT or TON · TON network |
| `support_copy` | Копировать | Copy |
| `support_copied` | Скопировано ✓ | Copied ✓ |
| `support_crypto_note` | Через Telegram → @wallet. Принимаю и USDT (TON), и TON. | Via Telegram → @wallet. I accept both USDT (TON) and TON. |

Тексты кнопок-входов («💛 Поддержать проект») переиспользуют существующие ключи
(`main_donate_banner_btn`, `main_footer_donate`, `about_donate_cta`).

## 7. План проверки (ручной — автотестов в проекте нет)

Загрузить распакованным в Chrome (`chrome://extensions` → Load unpacked):

1. Экран `#screen-support` открывается со всех 3 точек входа (баннер, footer, about).
2. Кнопка «Копировать» кладёт адрес в буфер; подпись меняется на «Скопировано ✓» и возвращается.
3. QR-PNG отображается, не битый.
4. Ссылка «Карта/ЮMoney» открывает Yoomoney в новой вкладке.
5. Локализация: переключить язык RU ↔ EN — все строки экрана переведены.
6. Темы: light / dark — экран читаем в обеих.
7. Кнопка «← Назад» возвращает на main.
8. Баннер после клика «Поддержать» по-прежнему ставит `dismissed` (не появляется снова).
9. Сверить QR и текстовый адрес — кодируют один и тот же адрес.

## 8. Открытые вопросы

Нет. QR-PNG генерируется на этапе реализации из адреса в §3.
