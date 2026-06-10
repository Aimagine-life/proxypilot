# Релизы (GitHub Release по тегу)

Workflow `.github/workflows/release.yml` по пушу тега `vX.Y.Z` собирает пакеты и
публикует их в GitHub Release, чтобы пользователям не нужно было ничего собирать.

## Как выпустить релиз

1. Подними версию в `extension/manifest.json` и `package.json` (они должны совпадать).
2. Закоммить, затем создай тег, совпадающий с версией, и запушь его:
   ```sh
   git tag v0.11.11
   git push origin v0.11.11
   ```
3. Workflow прогонит тесты, соберёт `proxypilot-chrome-<ver>.zip` и
   `proxypilot-firefox-<ver>.zip` и создаст Release с этими файлами.

Ручной запуск (вкладка Actions → Release → Run workflow) только собирает и тестирует,
релиз НЕ публикует (нет тега).

## Подписанный .xpi для Firefox (опционально)

Без подписи Firefox-zip ставится только временно. Чтобы в релиз попадал **постоянный
подписанный** `.xpi`, добавь в репозиторий секреты (Settings → Secrets and variables →
Actions):

- `AMO_API_KEY`
- `AMO_API_SECRET`

Получить их: https://addons.mozilla.org/developers/addon/api/key/ (бесплатный аккаунт
AMO). С этими секретами workflow подписывает сборку через `web-ext sign --channel
unlisted` и прикладывает `proxypilot-firefox-<ver>-signed.xpi` к релизу. Без секретов
шаг подписи пропускается — релиз всё равно выходит, но с неподписанным zip.

## Что в релизе

| Файл | Для кого |
|---|---|
| `proxypilot-chrome-<ver>.zip` | Chrome/Edge/Brave — распаковать, «Загрузить распакованное» |
| `proxypilot-firefox-<ver>.zip` | Firefox — временная загрузка (`about:debugging`) |
| `proxypilot-firefox-<ver>-signed.xpi` | Firefox — постоянная установка (только если заданы AMO-секреты) |

Инструкция для пользователей — [INSTALL.md](../INSTALL.md).
