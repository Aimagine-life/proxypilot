# Публикация в Opera Add-ons

Opera построена на Chromium и принимает тот же пакет Manifest V3, что и Chrome —
**отдельная сборка не нужна**, грузится `dist/chrome/proxypilot-<ver>.zip`.

> Пользователям расширение и так доступно в Opera через Chrome Web Store +
> аддон «Install Chrome Extensions» (см. README). Публикация в каталоге Opera
> Add-ons нужна только чтобы попасть в нативный поиск магазина Opera и получить
> авто-обновления для тех, кто ставит оттуда.

## Разовая настройка

1. Аккаунт разработчика: https://addons.opera.com/developer/ — регистрация
   **бесплатна** (взноса нет, в отличие от Chrome Web Store).
2. Подтвердить email.

## Публикация версии

1. Собрать пакет: `sh scripts/build.sh` → `dist/chrome/proxypilot-<ver>.zip`
   (Opera берёт именно chrome-вариант, не firefox).
2. Dev Console → **Add new add-on** → загрузить zip.
3. Заполнить листинг (можно переиспользовать тексты и ассеты Chrome Web Store):
   - Описание (RU + EN) — из `docs/chrome-web-store/` / store release notes.
   - Иконка — `docs/chrome-web-store/icon/proxypilot-128.png`.
   - Скриншоты — `docs/chrome-web-store/screenshots/*.png` (RU) и `.../en/*.png` (EN).
   - Категория: Privacy & Security / Tools.
4. Указать, что расширение использует прокси (`proxy`, `webRequest`) — для модерации
   пояснить назначение (доступ к AI-сервисам по выбранным доменам, не VPN на весь
   браузер; ничего не собирает).
5. Submit → ревью Opera (обычно несколько дней).

## Авто-публикация из CI

Пока **не настроена**. У Chrome Web Store и AMO в `.github/workflows/release.yml`
есть авто-загрузка по тегу (надёжные GitHub Actions / API). Для Opera Add-ons
готового стабильного экшена нет — версия загружается **вручную** через Dev Console.
Это нормально: Opera-аудитория покрывается и через Chrome Web Store.

## После одобрения

Публичная ссылка: `https://addons.opera.com/extensions/details/<slug>/`.
Добавить её в README рядом с кнопками Chrome/Firefox.

## Важно для пользователей Opera

У Opera есть встроенный **VPN**, который управляет трафиком и конфликтует с
расширением (как любое второе прокси-управление). В описании/FAQ стоит указать:
если сайты не открываются — отключить встроенный Opera VPN
(Настройки → Конфиденциальность → VPN). Это уже отражено в ATTENTION-блоке README.
