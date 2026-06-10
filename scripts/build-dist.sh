#!/usr/bin/env sh
# Упаковывает extension/ в dist/proxypilot-<version>.zip для загрузки в Chrome Web Store.
# Кладёт файлы так, что manifest.json оказывается в КОРНЕ архива (требование CWS).
# Запуск:  sh scripts/build-dist.sh
set -e
cd "$(dirname "$0")/.."

python - <<'PY'
import os, zipfile, json
ver = json.load(open("extension/manifest.json", encoding="utf-8"))["version"]
os.makedirs("dist", exist_ok=True)
out = f"dist/proxypilot-{ver}.zip"
n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, _, files in os.walk("extension"):
        for fn in files:
            full = os.path.join(dirpath, fn)
            z.write(full, os.path.relpath(full, "extension"))  # manifest.json at root
            n += 1
size = os.path.getsize(out) // 1024
print(f"Готово: {out} — {n} файлов, {size} КБ")
PY
