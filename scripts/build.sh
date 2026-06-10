#!/usr/bin/env sh
# Собирает dist/chrome/proxypilot-<ver>.zip и dist/firefox/proxypilot-<ver>.zip
# из общего extension/. Firefox-манифест патчится (background.scripts +
# browser_specific_settings, без webRequestAuthProvider). manifest.json в корне zip.
set -e
cd "$(dirname "$0")/.."

python - <<'PY'
import os, json, zipfile

ver = json.load(open("extension/manifest.json", encoding="utf-8"))["version"]

def zip_dir(src_dir, manifest_obj, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, _, files in os.walk(src_dir):
            for fn in files:
                if fn == "manifest.json":
                    continue
                full = os.path.join(dp, fn)
                z.writestr(os.path.relpath(full, src_dir), open(full, "rb").read())
        z.writestr("manifest.json", json.dumps(manifest_obj, ensure_ascii=False, indent=2))

base = json.load(open("extension/manifest.json", encoding="utf-8"))

# Chrome — как есть.
zip_dir("extension", base, f"dist/chrome/proxypilot-{ver}.zip")

# Firefox — патч манифеста.
ff = json.loads(json.dumps(base))  # deep copy
ff["background"] = {"scripts": ["background.js"], "type": "module"}
ff["browser_specific_settings"] = {"gecko": {"id": "proxypilot@wildbots.ru", "strict_min_version": "121.0"}}
ff["permissions"] = [p for p in ff.get("permissions", []) if p != "webRequestAuthProvider"]
zip_dir("extension", ff, f"dist/firefox/proxypilot-{ver}.zip")

print(f"Готово: dist/chrome/proxypilot-{ver}.zip, dist/firefox/proxypilot-{ver}.zip")
PY
