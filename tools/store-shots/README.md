# Store screenshots & promo generator

Renders the **real** popup (`popup.js` + `popup.css`) on any locale into store
assets for the Chrome Web Store and Firefox AMO. The popup runs against a mocked
`chrome.i18n` / `chrome.storage` (inlined demo state), so no real extension load
is needed — the UI is genuine and fully localized.

Add a language by adding it to `extension/_locales/`; the harness reads the same
messages. Nothing here ships in the extension — the generated `_shot.html` /
`_promo.html` live under `extension/popup/` only while shooting and must be
deleted afterwards (they are temp files, not part of the build).

## Generate the harness

```sh
node tools/store-shots/build-harness.mjs
# writes extension/popup/_shot.html  (banners + marquee, real popup inside)
#        extension/popup/_promo.html (small promo tile: logo + tagline)
```

## Shoot with Playwright

`file://` is blocked, so serve the extension dir over HTTP:

```sh
python -m http.server 8753 --directory extension
```

Then drive a headless browser (Playwright) at the target viewport and screenshot.
URL params for `_shot.html`:

- `lang=en|ru`
- `screen=main|free|settings|marquee`
- `w=&h=` — canvas size (default `1280x800`; marquee uses `w=1400&h=560`)

For `screen=free` and `screen=settings`, click `#open-settings` before the shot
(reveals the settings screen). `main` and `marquee` need no click.

`_promo.html` (440x280) takes only `lang=en|ru`.

### Asset matrix produced

| Asset | Size | Source | Format |
|---|---|---|---|
| Store screenshots | 1280x800 | `_shot.html?screen=main\|free\|settings` | PNG |
| Marquee promo tile | 1400x560 | `_shot.html?screen=marquee&w=1400&h=560` | JPEG (no alpha) |
| Small promo tile | 440x280 | `_promo.html` | JPEG (no alpha) |

JPEG is used for promo tiles because the stores require **no alpha channel**.

## Cleanup

```sh
rm extension/popup/_shot.html extension/popup/_promo.html
```

Generated PNG/JPEG assets are kept outside this repo (in the working assets
folder), not committed here.
