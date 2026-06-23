# Firefox Add-ons (AMO) — listing & publishing kit

Everything needed to publish **ProxyPilot** to the public Firefox Add-ons catalog
(`addons.mozilla.org`, "listed" channel), plus the one-time manual steps only the
owner can do. Copy-paste the texts below into the AMO submission form.

- Add-on ID (gecko): `proxypilot@wildbots.ru` (already in the Firefox manifest)
- Package to upload: `dist/firefox/proxypilot-<version>.zip` (built by `scripts/build.sh`)
- Channel: **listed** (public catalog, reviewed by Mozilla)
- After the listing exists, CI auto-uploads each new version (see `.github/workflows/release.yml`).

---

## 1. Listing metadata

**Name:** ProxyPilot — Proxy Manager & Smart Routing

**Summary (≤250 chars)**

- EN: `Per-site proxy manager & switcher. Route only the sites you choose through your own HTTP/SOCKS5 proxy or a curated free pool — everything else stays direct. Bring your own proxy — no account, no tracking.`
- RU: `Менеджер и переключатель прокси по доменам. Через ваш HTTP/SOCKS5-прокси или подобранный бесплатный пул идут только выбранные сайты — остальной трафик напрямую. Свой прокси, без аккаунта и слежки.`

**Description (full)**

- EN:
```
ProxyPilot is a per-site proxy manager and switcher. Route only the sites you
choose through your own HTTP/HTTPS/SOCKS5/SOCKS4 proxy (or a curated free pool)
— everything else connects directly. No account, no tracking, all local.

• Bring your own proxy (HTTP/HTTPS/SOCKS4/SOCKS5) — or let ProxyPilot pick a
  working one from a free public pool.
• Per-domain routing via a PAC script (Chromium) / proxy.onRequest (Firefox):
  only the domains you enable are proxied.
• Automatic protocol detection, proxy testing, and auto-rotation when a proxy dies.
• Light/dark theme. Clean popup UI. Interface in English and Russian (follows the
  browser language).

Privacy: ProxyPilot is a client only. It does not run, host, or sell any proxy,
and collects no analytics or telemetry. All settings are stored locally in your
browser. Free-pool proxy lists are fetched from public GitHub sources.

Note: public free proxies are untrusted — do not sign in to important accounts
while routing through them. The app warns you about this in the UI.
```

- RU:
```
ProxyPilot — менеджер и переключатель прокси по доменам. Через ваш
HTTP/HTTPS/SOCKS5/SOCKS4-прокси (или подобранный бесплатный пул) идут только
выбранные сайты — остальной трафик напрямую. Без аккаунта, без слежки, всё локально.

• Свой прокси (HTTP/HTTPS/SOCKS4/SOCKS5) — или подбор рабочего из бесплатного
  публичного пула.
• Маршрутизация по доменам через PAC-скрипт (Chromium) / proxy.onRequest (Firefox):
  проксируются только включённые вами домены.
• Автоопределение протокола, проверка прокси и авто-ротация при отказе.
• Светлая/тёмная тема. Аккуратный popup. Интерфейс на русском и английском
  (по языку браузера).

Приватность: ProxyPilot — только клиент. Он не запускает, не хостит и не продаёт
прокси, не собирает аналитику и телеметрию. Все настройки хранятся локально в
браузере. Списки бесплатного пула берутся из публичных источников на GitHub.

Важно: публичные бесплатные прокси не доверенные — не входите в важные аккаунты,
пока трафик идёт через них. Расширение предупреждает об этом в интерфейсе.
```

**Category:** Privacy & Security
**Tags:** proxy, socks, http proxy, proxy manager, routing
**Homepage:** https://wildbots.ru/
**Support site:** https://github.com/Aimagine-life/proxypilot
**Support email:** hello@wildbots.ru
**License:** MIT
**Default locale:** English (add Russian as a translation in the listing).

---

## 2. Privacy policy (paste into the "Privacy Policy" field)

- EN:
```
ProxyPilot does not collect, transmit, or sell any personal data. It includes no
analytics, telemetry, or tracking. All configuration (proxy settings, enabled
services, custom domains) is stored locally via the browser's storage API and
never leaves your device.

Network requests the extension makes on its own:
- Fetching public free-proxy lists from GitHub-hosted sources (only when you use
  the free pool).
- Fetching a public domain blocklist snapshot to mark domains that must not be
  routed (compliance check).
- A test request through your configured proxy when you press "Test proxy".

Your traffic is routed through the proxy YOU configure. ProxyPilot does not
operate any proxy server and cannot see your traffic.
```

- RU: (перевод того же текста — добавить как русскую локаль листинга)

---

## 3. Permission justifications (AMO reviewers ask for these)

| Permission | Why it is needed |
|---|---|
| `proxy` | Core feature: configures the browser proxy (PAC on Chromium, `proxy.onRequest` on Firefox) to route only the user-selected domains. |
| `storage`, `unlimitedStorage` | Stores settings locally (proxy config, enabled services, custom domains) and caches the free-proxy pool, which can be large — hence `unlimitedStorage`. No remote storage. |
| `webRequest` | Listens to `onErrorOccurred` to detect a dead proxy connection and auto-rotate to the next free proxy. On Chromium also used for proxy auth. Read-only — no request blocking or content modification. |
| `webRequestAuthProvider` | **Chromium only** — supplies the proxy username/password via `onAuthRequired`. The Firefox build **removes** this permission (the build script strips it; Firefox uses inline auth in the proxy descriptor). |
| `tabs` | Reads the active tab's URL to show the per-tab toolbar icon state (routed vs direct). No content scripts, no page access. |
| `alarms` | Periodic free-pool refresh (~5 min) and a daily blocklist compliance check. |
| `host_permissions: <all_urls>` | The PAC script / `proxy.onRequest` handler and the `onErrorOccurred` listener must be able to apply to any domain the user adds to their routing list. The extension does **not** read or modify page content on any site. |

---

## 4. Notes for the reviewer (paste into "Notes to reviewer")

```
- Manifest V3, vanilla JavaScript, no minification and no bundler.
- The source on GitHub (extension/) is shipped almost verbatim. The only build
  step (scripts/build.sh) zips extension/ and, for the Firefox package, patches
  the manifest: background.service_worker -> background.scripts, adds
  browser_specific_settings.gecko, and removes the webRequestAuthProvider
  permission (Firefox doesn't use it). No code is transformed.
- The extension is a proxy CLIENT only: it does not host, run, or recommend any
  specific proxy. Users bring their own, or opt into a public free pool.
- It does not inject content scripts and does not read page content.
Repository: https://github.com/Aimagine-life/proxypilot
```

> If AMO requests a source-code upload, point them at the GitHub repo (tagged
> release matching the version) or attach a zip of the repository root.

---

## 5. Screenshots

Use 3–5 from the prepared store assets (in the `crome-ai-freeroad` working folder):
`store-1.png`, `store-2.png`, `store-3.png` (or `free-light.png`, `about-light.png`,
`gear-light.png`). Icon: `extension/icons/app-128.png`.

---

## 6. One-time setup checklist (owner only — needs your Mozilla account)

1. **AMO developer account** — sign in at https://addons.mozilla.org/developers/
   (create one if needed; agree to the developer agreement).
2. **First submission (creates the listing):**
   - Developer Hub → **Submit a New Add-on** → **On this site** (listed).
   - Upload `dist/firefox/proxypilot-0.13.1.zip` (run `sh scripts/build.sh` to
     produce it; it's also attached to the GitHub release).
   - Fill the form using sections 1–5 above. Add Russian as a second locale.
   - Submit for review. Mozilla reviews listed add-ons (automated + sometimes
     manual); it can take from minutes to a few days.
3. **API keys for CI automation:**
   - https://addons.mozilla.org/developers/addon/api/key/ → generate credentials.
   - You get a **JWT issuer** (this is `AMO_API_KEY`) and a **JWT secret**
     (`AMO_API_SECRET`).
4. **Add the secrets to GitHub** (repo Settings → Secrets and variables → Actions,
   or via CLI — run these yourself so the values aren't logged):
   ```sh
   gh secret set AMO_API_KEY   --repo Aimagine-life/proxypilot
   gh secret set AMO_API_SECRET --repo Aimagine-life/proxypilot
   ```
5. **Done.** From the next tagged release (`vX.Y.Z`), CI builds the Firefox package
   and uploads the new version to the AMO listed channel automatically (see the
   "Publish Firefox to AMO" step in `release.yml`). The first version (0.13.1) is
   the one you upload manually in step 2.

After approval, the one-click install page is `https://addons.mozilla.org/firefox/addon/<slug>/`.
Add that link to README/INSTALL once it exists.
