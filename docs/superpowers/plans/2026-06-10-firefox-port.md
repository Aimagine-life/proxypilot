# Порт ProxyPilot на Firefox — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выпустить ProxyPilot для Firefox из общего исходника, заменив Chrome-специфичное проксирование (PAC) на платформенный адаптер (Firefox `proxy.onRequest`), и собрать оба пакета одним скриптом.

**Architecture:** Один `extension/` исходник. Лёгкий namespace-шим делает `chrome.*` промисным в обоих браузерах. Всё проксирование уходит за интерфейс `lib/proxy-backend.js` с двумя бэкендами (Chrome PAC ↔ Firefox onRequest), выбор по фиче-детекту. Доменная логика (`isHostRouted`) переиспользуется. Мини-билд патчит манифест под Firefox.

**Tech Stack:** Vanilla JS, ES-модули, Manifest V3, `node --test`, Firefox 121+.

**Спецификация:** `docs/superpowers/specs/2026-06-10-firefox-port-design.md`

---

## File Structure

- **Create** `extension/lib/compat.js` — namespace-шим (`chrome = browser` в Firefox), импортируется первым в entry-точках.
- **Create** `extension/lib/proxy-backend.js` — платформенный прокси-интерфейс: `applyProxy`/`clearProxy`/`probeThroughProxy`/`validateProxy`/`registerProxyAuth` + Firefox-хелперы (`ffDescriptor`/`ffHandleRequest`) для тестов. Содержит оба бэкенда, выбор по `isFirefox`.
- **Delete** `extension/lib/proxy.js` — его содержимое (applyProxy + onAuthRequired) переезжает в proxy-backend (Chrome-ветка).
- **Modify** `extension/background.js` — импорт из proxy-backend; `runProxyTest`/`detectScheme` через `probeThroughProxy`; шим compat первым импортом.
- **Modify** `extension/lib/free-pool.js` — убрать локальные `validateProxy`/`buildAllThroughPac`, импортировать `validateProxy` из proxy-backend.
- **Modify** `extension/popup/popup.js` — шим compat первым импортом (popup тоже зовёт `chrome.*` через сообщения, но шим нужен для `chrome.runtime`/`storage` промисов в FF).
- **Create** `scripts/build.sh` — сборка `dist/chrome/*.zip` и `dist/firefox/*.zip` с патчем манифеста.
- **Modify** `tests/free-pool.test.js` — импорт `validateProxy` из proxy-backend; мок `chrome` остаётся.
- **Create** `tests/proxy-backend.test.js` — тесты Firefox-адаптера (дескриптор, routed/direct, инлайн-авторизация, probe-override).
- **Create** `docs/firefox-amo/PUBLISHING.md` — листинг AMO (переиспользует Chrome-материалы).

Контракты `pac.js` (`buildPacScript`, `isHostRouted`, `collectDomains`) и форма `state` — без изменений.

---

## Task 1: Namespace-шим (`chrome.*` промисный в обоих браузерах)

В Firefox `chrome.*` колбэчный, промисный только `browser.*`. Шим делает `globalThis.chrome = browser` в Firefox — код остаётся на `chrome.*`, тесты не трогаем.

**Files:**
- Create: `extension/lib/compat.js`
- Test: `tests/compat.test.js`

- [ ] **Step 1: Падающий тест** — создать `tests/compat.test.js`:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

beforeEach(() => { delete globalThis.browser; delete globalThis.chrome; });

test('compat: в Firefox (есть browser) chrome становится browser', async () => {
  const fakeBrowser = { runtime: {}, _ff: true };
  globalThis.browser = fakeBrowser;
  globalThis.chrome = { _callbackStyle: true };
  await import(`../extension/lib/compat.js?ff=${Date.now()}`);
  assert.equal(globalThis.chrome, fakeBrowser);
});

test('compat: в Chrome (нет browser) chrome не трогается', async () => {
  const fakeChrome = { runtime: {}, _chrome: true };
  globalThis.chrome = fakeChrome;
  await import(`../extension/lib/compat.js?ch=${Date.now()}`);
  assert.equal(globalThis.chrome, fakeChrome);
  assert.equal(globalThis.browser, undefined);
});
```

- [ ] **Step 2: Запустить — упадёт** (`compat.js` нет):
Run: `cd /c/Users/Konstantin/projects/gemini-unblock && node --test tests/compat.test.js`
Expected: FAIL — Cannot find module compat.js.

- [ ] **Step 3: Реализовать** — `extension/lib/compat.js`:

```js
// Cross-browser namespace shim. Firefox exposes promise-based APIs on `browser`
// (its `chrome` is callback-only); Chrome MV3 has promise-based `chrome` and no
// `browser`. Reassigning chrome→browser in Firefox lets the rest of the codebase
// keep using `chrome.*` with promises in both browsers. No-op in Chrome.
// Import this FIRST in every entry point (background, popup).
if (typeof browser !== 'undefined' && browser && browser.runtime) {
  globalThis.chrome = browser;
}
```

- [ ] **Step 4: Запустить — пройдёт:**
Run: `node --test tests/compat.test.js`
Expected: PASS (2/2).

- [ ] **Step 5: Подключить шим первым импортом** в `extension/background.js` (самая первая строка-импорт):

```js
import './lib/compat.js';
```
(добавить ПЕРЕД `import { loadState, saveState } from './lib/storage.js';`)

И в `extension/popup/popup.js` (первой строкой, перед `import { loadState ...`):

```js
import '../lib/compat.js';
```

- [ ] **Step 6: Прогнать всё, убедиться что ничего не сломалось:**
Run: `npm test`
Expected: 122 pass (120 прежних + 2 новых), 0 fail.

- [ ] **Step 7: Commit**
```bash
git add extension/lib/compat.js extension/background.js extension/popup/popup.js tests/compat.test.js
git commit -m "feat(compat): namespace-шим chrome→browser для Firefox"
```

---

## Task 2: `proxy-backend.js` + Chrome-бэкенд (рефактор, поведение не меняется)

Выносим всё проксирование за один интерфейс. На этом шаге — только Chrome-реализация (перенос из `proxy.js` и `free-pool.js`), поведение идентично.

**Files:**
- Create: `extension/lib/proxy-backend.js`
- Delete: `extension/lib/proxy.js`
- Modify: `extension/background.js`, `extension/lib/free-pool.js`
- Test: `tests/free-pool.test.js`

- [ ] **Step 1: Создать `extension/lib/proxy-backend.js`** с Chrome-веткой (Firefox-ветки пока нет — добавим в Task 3):

```js
// Platform proxy backend. Chrome uses a PAC script via chrome.proxy.settings;
// Firefox (Task 3) uses chrome.proxy.onRequest. Routing logic (isHostRouted) is
// shared from pac.js so both backends route identically.
import { buildPacScript } from './pac.js';

const VALIDATE_URL = 'https://detectportal.firefox.com/success.txt';
const VALIDATE_TIMEOUT_MS = 4_000;

// Firefox exposes chrome.proxy.onRequest (after the compat shim); Chrome does not.
const isFirefox = !!(globalThis.chrome && chrome.proxy && chrome.proxy.onRequest);

// ---- shared ----
function pacDirective({ scheme, host, port }) {
  switch (scheme) {
    case 'https':  return `HTTPS ${host}:${port}`;
    case 'socks5': return `SOCKS5 ${host}:${port}; SOCKS ${host}:${port}`;
    case 'socks4': return `SOCKS ${host}:${port}`;
    default:       return `PROXY ${host}:${port}`;
  }
}
function allThroughPac(proxy) {
  return `function FindProxyForURL(url, host) { return "${pacDirective(proxy)}"; }`;
}

// ---- Chrome backend ----
async function chromeApply(state) {
  const pac = buildPacScript(state);
  if (pac === null) { await chrome.proxy.settings.clear({ scope: 'regular' }); return { applied: false }; }
  await chrome.proxy.settings.set({
    value: { mode: 'pac_script', pacScript: { data: pac, mandatory: true } },
    scope: 'regular',
  });
  return { applied: true };
}
async function chromeClear() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
}
// Route ALL traffic through `proxy`, fetch `url`, return the Response; restore on
// return. Used by validateProxy / runProxyTest / detectScheme.
async function chromeProbe(url, proxy, timeoutMs) {
  await chrome.proxy.settings.set({
    value: { mode: 'pac_script', pacScript: { data: allThroughPac(proxy), mandatory: true } },
    scope: 'regular',
  });
  try {
    return await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } finally {
    await chrome.proxy.settings.clear({ scope: 'regular' });
  }
}
function chromeRegisterAuth(loadState) {
  chrome.webRequest.onAuthRequired.addListener(
    (details, callback) => {
      if (!details.isProxy) { callback({}); return; }
      loadState()
        .then((state) => {
          const proxy = state?.proxy;
          if (!proxy?.user) { callback({}); return; }
          callback({ authCredentials: { username: proxy.user, password: proxy.pass || '' } });
        })
        .catch(() => callback({}));
    },
    { urls: ['<all_urls>'] },
    ['asyncBlocking'],
  );
}

// ---- public API ----
export async function applyProxy(state) {
  return chromeApply(state);
}
export async function clearProxy() {
  return chromeClear();
}
/** Route `url` through `proxy` once; resolve to { ok, status, json?, latencyMs, error }. */
export async function probeThroughProxy(url, proxy, { timeoutMs = VALIDATE_TIMEOUT_MS, parseJson = false } = {}) {
  const start = Date.now();
  try {
    const res = await chromeProbe(url, proxy, timeoutMs);
    const latencyMs = Date.now() - start;
    const out = { ok: res.ok, status: res.status, latencyMs, error: res.ok ? null : `HTTP ${res.status}` };
    if (parseJson && res.ok) { try { out.json = await res.json(); } catch { /* ignore */ } }
    return out;
  } catch (err) {
    return { ok: false, status: 0, latencyMs: Date.now() - start, error: String(err?.message || err) };
  }
}
/** Validate a free-pool candidate { protocol, host, port }. */
export async function validateProxy(candidate) {
  const r = await probeThroughProxy(VALIDATE_URL, {
    scheme: candidate.protocol, host: candidate.host, port: candidate.port,
  }, { timeoutMs: VALIDATE_TIMEOUT_MS });
  return { ok: r.ok, latencyMs: r.latencyMs, error: r.error };
}
export function registerProxyAuth(loadState) {
  if (isFirefox) return; // Firefox: inline auth in the proxy descriptor (Task 3)
  chromeRegisterAuth(loadState);
}
export { VALIDATE_URL };
```

- [ ] **Step 2: Удалить `extension/lib/proxy.js`:**
```bash
git rm extension/lib/proxy.js
```

- [ ] **Step 3: Обновить `extension/background.js` импорт.** Заменить строку
`import { applyProxy, registerAuthListener } from './lib/proxy.js';`
на
```js
import { applyProxy, registerProxyAuth, probeThroughProxy } from './lib/proxy-backend.js';
```
И заменить вызов `registerAuthListener();` на `registerProxyAuth(loadState);`.

- [ ] **Step 4: Заменить `buildAllThroughPac` в background.js на `probeThroughProxy`.**
Удалить функцию `buildAllThroughPac` в background.js. В `runProxyTest` заменить блок
hijack+fetch+restore на:
```js
async function runProxyTest(url) {
  const state = await loadState();
  if (!state.proxy?.host) return { ok: false, error: 'No proxy configured' };
  const r = await probeThroughProxy(url, state.proxy, { timeoutMs: 8000, parseJson: url.includes('ipinfo.io') });
  if (!r.ok) { await applyProxy(state); return { ok: false, error: r.error }; }
  let extra = {};
  if (url.includes('ipinfo.io') && r.json) {
    extra = { ip: r.json.ip, country: r.json.country };
    state.proxy.lastTest = { ok: true, ip: r.json.ip, country: r.json.country, latencyMs: r.latencyMs, at: Math.floor(Date.now() / 1000) };
    await saveState(state);
  } else {
    extra = { httpStatus: r.status };
  }
  await applyProxy(state);
  return { ok: true, latencyMs: r.latencyMs, ...extra };
}
```
(`probeThroughProxy` сам очищает временный proxy; финальный `applyProxy(state)` восстанавливает нормальную маршрутизацию.)

- [ ] **Step 5: Переписать `detectScheme` в background.js на `probeThroughProxy`.** Заменить тело цикла (set PAC + fetch + clear) на:
```js
  for (const scheme of candidates) {
    state.detectStatus = { running: true, trying: scheme };
    await saveState(state);
    const r = await probeThroughProxy('https://ipinfo.io/json', { scheme, host, port: Number(port) }, { timeoutMs: 4000 });
    if (r.ok) {
      state.proxy.scheme = scheme;
      state.detectStatus = { running: false, ok: true, scheme };
      await saveState(state);
      await applyProxy(state);
      return;
    }
  }
```

- [ ] **Step 6: Обновить `extension/lib/free-pool.js`.** Удалить из него функции
`validateProxy` и `buildAllThroughPac` и константы `VALIDATE_URL`/`VALIDATE_TIMEOUT_MS`
(они теперь в proxy-backend). Вверху добавить:
```js
import { validateProxy } from './proxy-backend.js';
```
`pickAndValidate` уже вызывает `validateProxy(cand)` — менять не нужно. Экспорт
`validateProxy` из free-pool сохранить как ре-экспорт для тестов:
```js
export { validateProxy } from './proxy-backend.js';
```

- [ ] **Step 7: Обновить `tests/free-pool.test.js`.** Тесты `validateProxy:` остаются —
`validateProxy` ре-экспортируется из free-pool. Мок `globalThis.chrome.proxy.settings`
уже есть. Проверить, что импорт `validateProxy` берётся из free-pool (ре-экспорт) —
строка `import { validateProxy } from '../extension/lib/free-pool.js';` работает.

- [ ] **Step 8: Прогнать тесты:**
Run: `npm test`
Expected: все зелёные (122). Поведение на Chrome идентично.

- [ ] **Step 9: Commit**
```bash
git add extension/lib/proxy-backend.js extension/background.js extension/lib/free-pool.js tests/free-pool.test.js
git rm extension/lib/proxy.js
git commit -m "refactor(proxy): вынести проксирование в proxy-backend (Chrome-бэкенд), probeThroughProxy"
```

---

## Task 3: Firefox-бэкенд в `proxy-backend.js`

**Files:**
- Modify: `extension/lib/proxy-backend.js`
- Test: `tests/proxy-backend.test.js`

- [ ] **Step 1: Падающие тесты** — создать `tests/proxy-backend.test.js`:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Firefox env: chrome.proxy.onRequest present.
let onRequestHandler = null;
beforeEach(() => {
  onRequestHandler = null;
  globalThis.chrome = {
    proxy: {
      onRequest: { addListener: (fn) => { onRequestHandler = fn; } },
      settings: { set: async () => {}, clear: async () => {} },
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    webRequest: { onAuthRequired: { addListener: () => {} } },
  };
});

const ROUTED_STATE = {
  enabled: true,
  proxy: { scheme: 'socks5', host: '1.2.3.4', port: 1080, user: 'u', pass: 'p' },
  presets: { gemini: { enabled: true, domains: ['gemini.google.com'] } },
  customDomains: [],
};

test('ffDescriptor: socks5 → type socks + инлайн-авторизация + proxyDNS', async () => {
  const { ffDescriptor } = await import(`../extension/lib/proxy-backend.js?d=${Date.now()}`);
  const d = ffDescriptor({ scheme: 'socks5', host: '1.2.3.4', port: 1080, user: 'u', pass: 'p' });
  assert.equal(d.type, 'socks');
  assert.equal(d.host, '1.2.3.4');
  assert.equal(d.port, 1080);
  assert.equal(d.username, 'u');
  assert.equal(d.password, 'p');
  assert.equal(d.proxyDNS, true);
});

test('ffDescriptor: http без авторизации → без username', async () => {
  const { ffDescriptor } = await import(`../extension/lib/proxy-backend.js?d=${Date.now()}`);
  const d = ffDescriptor({ scheme: 'http', host: '9.9.9.9', port: 8080 });
  assert.equal(d.type, 'http');
  assert.equal(d.username, undefined);
  assert.equal(d.proxyDNS, undefined);
});

test('Firefox applyProxy → onRequest роутит совпавший хост, иначе direct', async () => {
  const m = await import(`../extension/lib/proxy-backend.js?r=${Date.now()}`);
  await m.applyProxy(ROUTED_STATE);
  assert.ok(onRequestHandler, 'listener зарегистрирован');
  const routed = onRequestHandler({ url: 'https://gemini.google.com/app' });
  assert.equal(routed.type, 'socks');
  assert.equal(routed.host, '1.2.3.4');
  const direct = onRequestHandler({ url: 'https://example.com/' });
  assert.deepEqual(direct, { type: 'direct' });
});

test('Firefox clearProxy → onRequest возвращает direct', async () => {
  const m = await import(`../extension/lib/proxy-backend.js?c=${Date.now()}`);
  await m.applyProxy(ROUTED_STATE);
  await m.clearProxy();
  assert.deepEqual(onRequestHandler({ url: 'https://gemini.google.com/app' }), { type: 'direct' });
});

test('Firefox validateProxy: probe-override роутит тест-URL через кандидата', async () => {
  const m = await import(`../extension/lib/proxy-backend.js?v=${Date.now()}`);
  let routedThroughCandidate = false;
  globalThis.fetch = async (url) => {
    // во время probe onRequest должен вернуть кандидата для тест-URL
    const d = onRequestHandler({ url });
    routedThroughCandidate = d.type === 'socks' && d.host === '5.6.7.8';
    return { ok: true, status: 200 };
  };
  const r = await m.validateProxy({ protocol: 'socks5', host: '5.6.7.8', port: 1080 });
  assert.equal(r.ok, true);
  assert.equal(routedThroughCandidate, true);
  // после probe override снят — обычный хост снова direct
  assert.deepEqual(onRequestHandler({ url: 'https://example.com/' }), { type: 'direct' });
});
```

- [ ] **Step 2: Запустить — упадёт** (нет `ffDescriptor`/Firefox-ветки):
Run: `node --test tests/proxy-backend.test.js`
Expected: FAIL.

- [ ] **Step 3: Реализовать Firefox-ветку** в `extension/lib/proxy-backend.js`. Добавить
импорт `isHostRouted` и Firefox-логику, и развести публичный API по `isFirefox`:

```js
import { buildPacScript, isHostRouted } from './pac.js';   // обновить существующий импорт
```
Добавить после Chrome-бэкенда:
```js
// ---- Firefox backend ----
const FF_TYPE = { http: 'http', https: 'https', socks5: 'socks', socks4: 'socks4', auto: 'http' };
let ffState = null;
let ffListenerAdded = false;
let ffProbe = null; // { url, proxy } — временный override для validateProxy/probe

export function ffDescriptor(proxy) {
  const type = FF_TYPE[proxy.scheme] || 'http';
  const d = { type, host: proxy.host, port: Number(proxy.port) };
  if (proxy.user) { d.username = proxy.user; d.password = proxy.pass || ''; }
  if (type === 'socks' || type === 'socks4') d.proxyDNS = true;
  return d;
}
export function ffHandleRequest(info) {
  if (ffProbe && typeof info.url === 'string' && info.url.startsWith(ffProbe.url)) {
    return ffDescriptor(ffProbe.proxy);
  }
  if (!ffState || !ffState.enabled || !ffState.proxy?.host) return { type: 'direct' };
  let host;
  try { host = new URL(info.url).hostname; } catch { return { type: 'direct' }; }
  return isHostRouted(host, ffState) ? ffDescriptor(ffState.proxy) : { type: 'direct' };
}
function ffEnsureListener() {
  if (ffListenerAdded) return;
  chrome.proxy.onRequest.addListener(ffHandleRequest, { urls: ['<all_urls>'] });
  ffListenerAdded = true;
}
async function ffProbeThrough(url, proxy, timeoutMs) {
  ffEnsureListener();
  ffProbe = { url, proxy };
  try {
    return await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } finally {
    ffProbe = null;
  }
}
```
Затем заменить публичные функции на разводку по `isFirefox`:
```js
export async function applyProxy(state) {
  if (isFirefox) { ffState = state; ffEnsureListener(); return { applied: buildPacScript(state) !== null }; }
  return chromeApply(state);
}
export async function clearProxy() {
  if (isFirefox) { ffState = ffState ? { ...ffState, enabled: false } : null; return; }
  return chromeClear();
}
```
И в `probeThroughProxy` выбрать механизм:
```js
    const res = isFirefox
      ? await ffProbeThrough(url, proxy, timeoutMs)
      : await chromeProbe(url, proxy, timeoutMs);
```
(заменить строку `const res = await chromeProbe(...)`).

- [ ] **Step 4: Запустить — Firefox-тесты зелёные:**
Run: `node --test tests/proxy-backend.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Прогнать всё (Chrome-путь не сломан):**
Run: `npm test`
Expected: все зелёные.

- [ ] **Step 6: Commit**
```bash
git add extension/lib/proxy-backend.js tests/proxy-backend.test.js
git commit -m "feat(proxy): Firefox-бэкенд (proxy.onRequest, инлайн-авторизация, probe-override)"
```

---

## Task 4: Мини-билд под оба браузера

**Files:**
- Create: `scripts/build.sh`
- Delete: `scripts/build-dist.sh` (заменяется новым)

- [ ] **Step 1: Создать `scripts/build.sh`:**

```sh
#!/usr/bin/env sh
# Собирает dist/chrome/proxypilot-<ver>.zip и dist/firefox/proxypilot-<ver>.zip
# из общего extension/. Firefox-манифест патчится (background.scripts +
# browser_specific_settings, без webRequestAuthProvider). manifest.json в корне zip.
set -e
cd "$(dirname "$0")/.."

python - <<'PY'
import os, json, zipfile, shutil

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
```

- [ ] **Step 2: Удалить старый скрипт и поправить ссылки:**
```bash
git rm scripts/build-dist.sh
```
В `docs/chrome-web-store/PUBLISHING.md` заменить упоминания `sh scripts/build-dist.sh`
на `sh scripts/build.sh` (путь к Chrome-zip теперь `dist/chrome/proxypilot-<ver>.zip`).

- [ ] **Step 3: Запустить сборку и проверить оба пакета:**
```bash
sh scripts/build.sh
python - <<'PY'
import zipfile, json
for b in ("chrome","firefox"):
    import glob; z=sorted(glob.glob(f"dist/{b}/*.zip"))[-1]
    with zipfile.ZipFile(z) as zf:
        names=zf.namelist(); m=json.loads(zf.read("manifest.json"))
        print(b, "manifest@root:", "manifest.json" in names, "| background:", list(m["background"].keys()),
              "| gecko:", "browser_specific_settings" in m, "| has webRequestAuthProvider:", "webRequestAuthProvider" in m.get("permissions",[]))
PY
```
Expected:
```
chrome manifest@root: True | background: ['service_worker', 'type'] | gecko: False | has webRequestAuthProvider: True
firefox manifest@root: True | background: ['scripts', 'type'] | gecko: True | has webRequestAuthProvider: False
```

- [ ] **Step 4: Commit**
```bash
git add scripts/build.sh docs/chrome-web-store/PUBLISHING.md
git rm scripts/build-dist.sh
git commit -m "build: единый build.sh — chrome.zip и firefox.zip (патч манифеста)"
```

---

## Task 5: Документы AMO

**Files:**
- Create: `docs/firefox-amo/PUBLISHING.md`

- [ ] **Step 1: Создать `docs/firefox-amo/PUBLISHING.md`:**

```markdown
# Публикация ProxyPilot на Firefox Add-ons (AMO)

## Пакет
`sh scripts/build.sh` → `dist/firefox/proxypilot-<ver>.zip` (manifest.json в корне,
background.scripts, browser_specific_settings.gecko, без webRequestAuthProvider).

## Аккаунт
https://addons.mozilla.org/developers/ — регистрация бесплатна (взноса нет).

## Листинг (переиспользуем Chrome-материалы)
- Название/описание/summary — из `docs/chrome-web-store/PUBLISHING.md` §3.
- Иконки — `extension/icons/light/off-128.png`.
- Скриншоты — `docs/chrome-web-store/screenshots/` (AMO принимает те же).
- Категория: Privacy & Security (или Other).
- Privacy policy — тот же URL, что для Chrome (`docs/chrome-web-store/privacy-policy.md`).

## Разрешения (обоснования те же, что в Chrome §5)
`<all_urls>` — для proxy.onRequest и webRequest-ротации; авторизация прокси в Firefox
инлайн в дескрипторе (без webRequestAuthProvider). Расширение не читает контент страниц.

## Источники (Source code)
Mozilla может запросить исходники. Сборка лишь копирует файлы и патчит манифест
(`scripts/build.sh`), минификации/бандла нет — рецензент собирает тем же скриптом.
Укажи это в поле «Notes to reviewer».

## После публикации
Ссылку на страницу AMO добавить в `extension/popup/popup.html` (кнопка «Оценить»),
если решишь показывать её для Firefox-сборки.
```

- [ ] **Step 2: Commit**
```bash
git add docs/firefox-amo/PUBLISHING.md
git commit -m "docs(amo): материалы для публикации в Firefox Add-ons"
```

---

## Task 6: Финальная верификация

**Files:** нет (прогон + ручной смоук)

- [ ] **Step 1: Полный прогон тестов:**
Run: `npm test`
Expected: все зелёные (≈127: 120 прежних + 2 compat + 5 proxy-backend).

- [ ] **Step 2: Проверить отсутствие ссылок на удалённое:**
Run: `grep -rn "lib/proxy.js\|buildAllThroughPac\|registerAuthListener" extension/`
Expected: пусто.

- [ ] **Step 3: Ручной смоук (отметить выполнение):**
  - Chrome: `chrome://extensions` → Load unpacked → `dist/chrome/` распаковать или грузить `extension/`. Проверить: бесплатный пул подбирается, «Проверить прокси» работает, маршрутизация включается.
  - Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → выбрать `dist/firefox/proxypilot-<ver>.zip` (или `manifest.json` из распакованного firefox-билда). Проверить: включение прокси на пресет-домене, авторизация своего прокси (инлайн), «Проверить прокси», подбор бесплатного.

- [ ] **Step 4: Commit (если правки по смоуку)** — иначе пропустить.

---

## Self-Review (выполнено автором плана)

**Spec coverage:** namespace-шим (Task 1) ✓; прокси-адаптер Chrome+Firefox (Task 2,3) ✓; `isHostRouted` переиспользуется (Task 3) ✓; инлайн-авторизация Firefox (Task 3, ffDescriptor) ✓; validateProxy/probe оба браузера (Task 2,3) ✓; runProxyTest+detectScheme адаптированы (Task 2, шаги 4–5) ✓; мини-билд + патч манифеста (Task 4) ✓; тесты на browser-мок + Firefox-адаптер (Task 1,3) ✓; AMO (Task 5) ✓. Spec упоминал `onErrorOccurred` для ротации — он namespace-агностичен (через шим работает в обоих), отдельной правки не требует; отмечено как риск в spec.

**Placeholder scan:** код приведён полностью в каждом шаге; «TBD»/«handle errors» нет.

**Type consistency:** `probeThroughProxy(url, proxy, opts)` единообразна; `proxy` везде `{scheme,host,port,user?,pass?}`; `ffDescriptor`/`ffHandleRequest` согласованы; `validateProxy(candidate{protocol,host,port})` сохраняет прежнюю сигнатуру для free-pool; `isFirefox` вычисляется один раз.

**Известный нюанс:** Task 2 и 3 связаны (Firefox-ветка без Task 3 отсутствует, но Chrome-путь Task 2 полностью рабочий и тестируемый сам по себе — можно коммитить отдельно).
