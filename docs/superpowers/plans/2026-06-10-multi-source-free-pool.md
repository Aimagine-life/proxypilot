# Мультиисточниковый бесплатный пул — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширить «Бесплатный пул» ProxyPilot с одного источника (Proxifly) до шести, сохранив весь конвейер фильтрации/валидации/ротации и периодику.

**Architecture:** Массив адаптеров. `fetchPool` тянет 6 фидов через `Promise.allSettled`, каждый адаптер нормализует к единому `{host,port,protocol,country,score,anonymity,httpsCapable}`, результат сливается с дедупом. `filterPool`/`validateProxy`/`pickAndValidate`/`nextLiveProxy` и `background.js` не меняются.

**Tech Stack:** Vanilla JS, ES-модули, `node --test`, Manifest V3.

**Спецификация:** `docs/superpowers/specs/2026-06-10-multi-source-free-pool-design.md`

---

## File Structure

- **Modify:** `extension/lib/free-pool.js` — реестр источников, адаптеры, слияние, рефактор `fetchPool`. Единственный файл логики (следуем текущему «один lib-файл на ответственность»).
- **Modify:** `tests/free-pool.test.js` — юнит-тесты адаптеров и дедупа; рефактор тестов `fetchPool` и `pickAndValidate` под мультиисточник.
- **Modify:** `README.md` — список источников в секции «Бесплатный пул» (RU + EN).
- **Modify:** `extension/manifest.json`, `package.json` — bump версии 0.9.0 → 0.10.0.

Ключевые контракты (неизменны для downstream):
```
NormalizedProxy = { host:string, port:int, protocol:'http'|'https'|'socks4'|'socks5',
                    country:string|null, score:number, anonymity:string|null, httpsCapable:boolean }
fetchPool({force}) -> Promise<NormalizedProxy[]>
```

---

## Task 1: Адаптеры источников (чистые функции)

Вводим `makeProxy`, `parseJsonOrNdjson` и пять парсеров. Это НОВЫЕ экспортируемые функции; существующие `normalizePool`/`parseRaw`/`fetchPool` пока не трогаем — все старые тесты остаются зелёными.

**Files:**
- Modify: `extension/lib/free-pool.js` (добавить функции рядом с существующими)
- Test: `tests/free-pool.test.js` (добавить блок тестов адаптеров)

- [ ] **Step 1: Написать падающие тесты адаптеров**

Добавить в конец `tests/free-pool.test.js`:

```js
import {
  makeProxy, parseProxifly, parseProxyscrape, parseMonosans, parseHideip, parseTxt,
} from '../extension/lib/free-pool.js';

test('makeProxy: валидная socks5 запись → httpsCapable=true', () => {
  const p = makeProxy({ host: '1.2.3.4', port: 1080, protocol: 'socks5', country: 'NL' });
  assert.deepEqual(p, { host: '1.2.3.4', port: 1080, protocol: 'socks5', country: 'NL', score: 0, anonymity: null, httpsCapable: true });
});

test('makeProxy: http без https-флага → httpsCapable=false', () => {
  assert.equal(makeProxy({ host: '1.2.3.4', port: 80, protocol: 'http' }).httpsCapable, false);
});

test('makeProxy: http с https=true → httpsCapable=true', () => {
  assert.equal(makeProxy({ host: '1.2.3.4', port: 80, protocol: 'http', https: true }).httpsCapable, true);
});

test('makeProxy: невалидный порт/хост/протокол → null', () => {
  assert.equal(makeProxy({ host: '1.2.3.4', port: 99999, protocol: 'http' }), null);
  assert.equal(makeProxy({ host: '', port: 80, protocol: 'http' }), null);
  assert.equal(makeProxy({ host: '1.2.3.4', port: 80, protocol: 'foobar' }), null);
});

test('parseProxifly: JSON array', () => {
  const pool = parseProxifly(JSON.stringify(SAMPLE_POOL));
  assert.equal(pool.length, 3);
  assert.equal(pool[0].host, '1.2.3.4');
  assert.equal(pool[0].country, 'NL');
  assert.equal(pool[0].score, 100);
  assert.equal(pool[0].anonymity, 'elite');
});

test('parseProxifly: NDJSON', () => {
  const ndjson = SAMPLE_POOL.map((e) => JSON.stringify(e)).join('\n');
  assert.equal(parseProxifly(ndjson).length, 3);
});

test('parseProxifly: отбрасывает без ip/port, невалидный порт, неизвестный протокол', () => {
  const data = [
    { protocol: 'http', port: 80, geolocation: { country: 'US' } },
    { protocol: 'http', ip: '1.2.3.4', geolocation: { country: 'US' } },
    { protocol: 'http', ip: '1.2.3.4', port: 99999, geolocation: { country: 'US' } },
    { protocol: 'foobar', ip: '1.2.3.4', port: 80, geolocation: { country: 'US' } },
    { protocol: 'http', ip: '1.2.3.4', port: 8080, geolocation: { country: 'US' } },
  ];
  const pool = parseProxifly(JSON.stringify(data));
  assert.equal(pool.length, 1);
  assert.equal(pool[0].host, '1.2.3.4');
});

test('parseProxyscrape: берёт country_code (ISO), ssl→httpsCapable, uptime_percent→score', () => {
  const data = [{ protocol: 'http', ip: '9.9.9.9', port: 8080, country: 'Germany', country_code: 'DE', anonymity: 'elite', ssl: true, uptime_percent: 88 }];
  const pool = parseProxyscrape(JSON.stringify(data));
  assert.equal(pool[0].country, 'DE');        // не "Germany"
  assert.equal(pool[0].httpsCapable, true);   // ssl
  assert.equal(pool[0].score, 88);
});

test('parseMonosans: host + geolocation.country.iso_code, RU-запись остаётся (отсев — в filterPool)', () => {
  const data = [{ protocol: 'socks5', host: '147.45.146.97', port: 1080, geolocation: { country: { iso_code: 'RU' } } }];
  const pool = parseMonosans(JSON.stringify(data));
  assert.equal(pool[0].host, '147.45.146.97');
  assert.equal(pool[0].protocol, 'socks5');
  assert.equal(pool[0].country, 'RU');
  assert.equal(pool[0].anonymity, null);
});

test('parseHideip: ip:port:Name, блокируемое имя→ISO, прочее→null, proto из аргумента', () => {
  const text = '1.2.3.4:8080:United States\n9.9.9.9:1080:Russia\n5.5.5.5:3128:Guatemala';
  const pool = parseHideip(text, 'http');
  assert.equal(pool.length, 3);
  assert.equal(pool[0].country, null);   // United States — не блокируемое
  assert.equal(pool[1].country, 'RU');   // Russia → RU
  assert.equal(pool[2].country, null);   // Guatemala
  assert.equal(pool[0].protocol, 'http');
});

test('parseTxt: чистый ip:port, proto из аргумента, country null', () => {
  const pool = parseTxt('31.131.248.51:3129\n46.62.214.3:1080\nгрязь\n', 'socks5');
  assert.equal(pool.length, 2);
  assert.equal(pool[0].host, '31.131.248.51');
  assert.equal(pool[0].protocol, 'socks5');
  assert.equal(pool[0].country, null);
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd /c/Users/Konstantin/projects/gemini-unblock && node --test tests/free-pool.test.js`
Expected: FAIL — `parseProxifly is not exported` / `makeProxy is not a function`.

- [ ] **Step 3: Реализовать функции**

В `extension/lib/free-pool.js` добавить (рядом с существующими, выше `fetchPool`):

```js
const VALID_PROTOCOLS = ['http', 'https', 'socks4', 'socks5'];
// Полные имена стран → ISO только для блокируемых (hideip отдаёт страну именем).
const BLOCKED_NAME_TO_ISO = { Russia: 'RU', Belarus: 'BY', China: 'CN', Iran: 'IR' };

/** Валидирует и нормализует одну запись. Возвращает NormalizedProxy или null. */
export function makeProxy({ host, port, protocol, country = null, score = 0, anonymity = null, https = false }) {
  const p = Number(port);
  if (!host || !Number.isInteger(p) || p < 1 || p > 65535) return null;
  const proto = String(protocol || '').toLowerCase();
  if (!VALID_PROTOCOLS.includes(proto)) return null;
  // SOCKS туннелирует любой TCP → HTTPS-способен; http — только если фид это явно подтвердил.
  const httpsCapable = https === true || proto === 'socks4' || proto === 'socks5';
  return {
    host: String(host), port: p, protocol: proto,
    country: country || null, score: Number(score) || 0,
    anonymity: anonymity || null, httpsCapable,
  };
}

/** JSON-массив ИЛИ NDJSON (по объекту на строку) → массив объектов. */
function parseJsonOrNdjson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  const out = [];
  for (const line of trimmed.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip malformed */ }
  }
  return out;
}

/** Proxifly: ip/port/protocol, geolocation.country||country (уже ISO), https, anonymity, score. */
export function parseProxifly(text) {
  const out = [];
  for (const e of parseJsonOrNdjson(text)) {
    const p = makeProxy({
      host: e?.ip, port: e?.port, protocol: e?.protocol,
      country: e?.geolocation?.country || e?.country || null,
      score: Number(e?.score) || 0,
      anonymity: e?.anonymity || null,
      https: e?.https === true,
    });
    if (p) out.push(p);
  }
  return out;
}

/** ProxyScrape (GitHub CDN): country=полное имя, ISO в country_code; ssl→https, uptime_percent→score. */
export function parseProxyscrape(text) {
  const data = parseJsonOrNdjson(text);
  const arr = Array.isArray(data) ? data : (data?.proxies || data?.data || []);
  const out = [];
  for (const e of arr) {
    const p = makeProxy({
      host: e?.ip, port: e?.port, protocol: e?.protocol,
      country: e?.country_code || null,
      score: Number(e?.uptime_percent) || 0,
      anonymity: e?.anonymity || null,
      https: e?.ssl === true,
    });
    if (p) out.push(p);
  }
  return out;
}

/** monosans: host/port/protocol, ISO в geolocation.country.iso_code; нет anonymity/ssl/score. */
export function parseMonosans(text) {
  const data = parseJsonOrNdjson(text);
  const arr = Array.isArray(data) ? data : [];
  const out = [];
  for (const e of arr) {
    const p = makeProxy({
      host: e?.host, port: e?.port, protocol: e?.protocol,
      country: e?.geolocation?.country?.iso_code || null,
    });
    if (p) out.push(p);
  }
  return out;
}

/** hideip.me: строки "ip:port:CountryName". Имя→ISO только для блокируемых, прочее→null. */
export function parseHideip(text, proto) {
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const parts = s.split(':');
    if (parts.length < 2) continue;
    const name = parts.slice(2).join(':').trim();
    const p = makeProxy({
      host: parts[0], port: parts[1], protocol: proto,
      country: BLOCKED_NAME_TO_ISO[name] || null,
    });
    if (p) out.push(p);
  }
  return out;
}

/** Чистый список "ip:port" (по строке). Протокол из аргумента, страна неизвестна. */
export function parseTxt(text, proto) {
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || !s.includes(':')) continue;
    const host = s.split(':')[0];
    const port = s.split(':')[1].split(/[\s#]/)[0];
    const p = makeProxy({ host, port, protocol: proto });
    if (p) out.push(p);
  }
  return out;
}
```

- [ ] **Step 4: Запустить — убедиться, что прошло**

Run: `cd /c/Users/Konstantin/projects/gemini-unblock && node --test tests/free-pool.test.js`
Expected: PASS — новые тесты зелёные, старые не затронуты.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/free-pool.js tests/free-pool.test.js
git commit -m "feat(free-pool): добавить адаптеры источников (proxifly/proxyscrape/monosans/hideip/txt)"
```

---

## Task 2: Дедуп объединённого пула

**Files:**
- Modify: `extension/lib/free-pool.js`
- Test: `tests/free-pool.test.js`

- [ ] **Step 1: Написать падающий тест**

```js
import { dedupePool } from '../extension/lib/free-pool.js';

test('dedupePool: дубль protocol:host:port сливается (max score, OR httpsCapable, первое непустое country)', () => {
  const merged = dedupePool([
    { host: '1.1.1.1', port: 80, protocol: 'http', country: null, score: 10, anonymity: null, httpsCapable: false },
    { host: '1.1.1.1', port: 80, protocol: 'http', country: 'NL', score: 50, anonymity: 'elite', httpsCapable: true },
    { host: '2.2.2.2', port: 1080, protocol: 'socks5', country: 'US', score: 0, anonymity: null, httpsCapable: true },
  ]);
  assert.equal(merged.length, 2);
  const first = merged.find((p) => p.host === '1.1.1.1');
  assert.equal(first.score, 50);
  assert.equal(first.httpsCapable, true);
  assert.equal(first.country, 'NL');
  assert.equal(first.anonymity, 'elite');
});

test('dedupePool: разные протоколы на одном host:port — это разные записи', () => {
  const merged = dedupePool([
    { host: '1.1.1.1', port: 80, protocol: 'http', country: null, score: 0, anonymity: null, httpsCapable: false },
    { host: '1.1.1.1', port: 80, protocol: 'socks5', country: null, score: 0, anonymity: null, httpsCapable: true },
  ]);
  assert.equal(merged.length, 2);
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test tests/free-pool.test.js`
Expected: FAIL — `dedupePool is not exported`.

- [ ] **Step 3: Реализовать**

В `extension/lib/free-pool.js`:

```js
/** Дедуп по protocol:host:port. При дубле: max score, OR httpsCapable, первое непустое country/anonymity. */
export function dedupePool(list) {
  const map = new Map();
  for (const p of list) {
    const key = `${p.protocol}:${p.host}:${p.port}`;
    const existing = map.get(key);
    if (!existing) { map.set(key, { ...p }); continue; }
    existing.score = Math.max(existing.score || 0, p.score || 0);
    existing.httpsCapable = existing.httpsCapable || p.httpsCapable;
    if (!existing.country && p.country) existing.country = p.country;
    if (!existing.anonymity && p.anonymity) existing.anonymity = p.anonymity;
  }
  return [...map.values()];
}
```

- [ ] **Step 4: Запустить — убедиться, что прошло**

Run: `node --test tests/free-pool.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/free-pool.js tests/free-pool.test.js
git commit -m "feat(free-pool): дедуп объединённого пула по protocol:host:port"
```

---

## Task 3: Реестр источников + `fetchAllSources`

**Files:**
- Modify: `extension/lib/free-pool.js`
- Test: `tests/free-pool.test.js`

- [ ] **Step 1: Написать падающие тесты**

Тест-харнес сейчас использует очередь `mockFetchResponses` и сдвигает по порядку вызова `fetch`. `Promise.allSettled(SOURCES.map(...))` вызывает `fetch` синхронно в порядке `SOURCES`, поэтому очередь из ответов в порядке источников детерминирована.

```js
import { fetchAllSources, SOURCES } from '../extension/lib/free-pool.js';

test('SOURCES: 6 источников с обязательными полями', () => {
  assert.equal(SOURCES.length, 6);
  for (const s of SOURCES) {
    assert.ok(s.name && s.url && s.kind, `источник без обязательных полей: ${JSON.stringify(s)}`);
  }
});

test('fetchAllSources: склеивает успешные, дефолтный score применяется', async () => {
  // Порядок ответов = порядок SOURCES. proxifly отдаёт 1 запись, остальные — пусто/ошибка.
  const proxiflyOne = [{ protocol: 'socks5', ip: '1.2.3.4', port: 1080, anonymity: 'elite', score: 0, geolocation: { country: 'NL' } }];
  const monosansOne = [{ protocol: 'socks5', host: '5.6.7.8', port: 1080, geolocation: { country: { iso_code: 'US' } } }];
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(proxiflyOne) }));   // proxifly
  mockFetchResponses.push(mockResponse({ text: '[]' }));                          // proxyscrape
  mockFetchResponses.push(mockResponse({ text: JSON.stringify(monosansOne) }));   // monosans (defaultScore)
  mockFetchResponses.push(mockResponse({ text: '' }));                            // zloi-http
  mockFetchResponses.push(mockResponse({ text: '' }));                            // zloi-socks5
  mockFetchResponses.push(mockResponse({ text: '' }));                            // hookzof
  const pool = await fetchAllSources();
  const mono = pool.find((p) => p.host === '5.6.7.8');
  assert.ok(mono, 'monosans запись присутствует');
  assert.ok(mono.score > 0, 'дефолтный score применён к фиду без score');
  assert.ok(pool.find((p) => p.host === '1.2.3.4'), 'proxifly запись присутствует');
});

test('fetchAllSources: один источник падает — пул собирается из остальных', async () => {
  mockFetchResponses.push(new Error('proxifly down'));                            // proxifly падает
  for (let i = 1; i < SOURCES.length - 1; i++) mockFetchResponses.push(mockResponse({ text: '[]' }));
  mockFetchResponses.push(mockResponse({ text: '9.9.9.9:1080\n' }));              // hookzof (txt socks5)
  const pool = await fetchAllSources();
  assert.ok(pool.find((p) => p.host === '9.9.9.9'));
});

test('fetchAllSources: все источники упали → throw', async () => {
  for (let i = 0; i < SOURCES.length; i++) mockFetchResponses.push(new Error('down'));
  await assert.rejects(() => fetchAllSources(), /источник/i);
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test tests/free-pool.test.js`
Expected: FAIL — `SOURCES is not exported` / `fetchAllSources is not a function`.

- [ ] **Step 3: Реализовать**

В `extension/lib/free-pool.js`. Удалить строку `const POOL_URL = '...'` и добавить:

```js
export const SOURCES = [
  { name: 'proxifly',    kind: 'proxifly',    url: 'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/all/data.json' },
  { name: 'proxyscrape', kind: 'proxyscrape', url: 'https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/all/data.json' },
  { name: 'monosans',    kind: 'monosans',    url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies.json',          defaultScore: 60 },
  { name: 'zloi-http',   kind: 'hideip', proto: 'http',   url: 'https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt',   defaultScore: 55 },
  { name: 'zloi-socks5', kind: 'hideip', proto: 'socks5', url: 'https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt', defaultScore: 70 },
  { name: 'hookzof',     kind: 'txt',    proto: 'socks5', url: 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt', defaultScore: 50 },
];

const ADAPTERS = {
  proxifly: parseProxifly,
  proxyscrape: parseProxyscrape,
  monosans: parseMonosans,
  hideip: parseHideip,
  txt: parseTxt,
};

/**
 * Тянет все SOURCES параллельно (Promise.allSettled — падение одного фида не
 * роняет остальные), нормализует адаптером, применяет дефолтный score фида к
 * записям без score, сливает с дедупом. Бросает, только если упали ВСЕ источники.
 */
async function fetchAllSources() {
  const settled = await Promise.allSettled(SOURCES.map(async (src) => {
    const res = await fetch(src.url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${src.name}: HTTP ${res.status}`);
    const text = await res.text();
    const parsed = ADAPTERS[src.kind](text, src.proto);
    if (src.defaultScore) for (const p of parsed) if (!p.score) p.score = src.defaultScore;
    return parsed;
  }));

  const merged = [];
  let okCount = 0;
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === 'fulfilled') { okCount++; merged.push(...settled[i].value); }
    else console.warn(`[FreePool] источник ${SOURCES[i].name} недоступен:`, settled[i].reason?.message || settled[i].reason);
  }
  if (okCount === 0) throw new Error('все источники недоступны');
  return dedupePool(merged);
}

export { fetchAllSources };
```

(`export function fetchAllSources` тоже допустимо — выбрать один способ экспорта. Здесь — именованный re-export для наглядности рядом с определением.)

- [ ] **Step 4: Запустить — убедиться, что прошло**

Run: `node --test tests/free-pool.test.js`
Expected: PASS для новых тестов. Тесты `fetchPool` ещё ссылаются на `POOL_URL`-логику — на этом шаге `fetchPool` ВРЕМЕННО сломан, т.к. `POOL_URL` удалён. Это исправляется в Task 4. Если линтер/импорт ломает весь файл — допустимо иметь красные `fetchPool`-тесты до Task 4, но файл должен парситься. Проверить, что НОВЫЕ тесты (`fetchAllSources`, `SOURCES`, адаптеры, дедуп) зелёные.

> ⚠️ Если на этом шаге `fetchPool` обращается к `POOL_URL`, временно оставь `const POOL_URL` объявление (не используется) ИЛИ сразу переходи к Task 4 в одном коммите. Рекомендуется: выполнить Task 3 и Task 4 подряд и закоммитить вместе, чтобы дерево не оставалось со сломанными тестами.

- [ ] **Step 5: Commit (вместе с Task 4 — см. примечание)**

Перейти к Task 4 без отдельного коммита; закоммитить ядро целиком после Task 4.

---

## Task 4: Перевести `fetchPool` на мультиисточник + кэш нормализованного пула

**Files:**
- Modify: `extension/lib/free-pool.js`
- Test: `tests/free-pool.test.js`

- [ ] **Step 1: Переписать тесты `fetchPool` и хелпер для `pickAndValidate`**

Удалить старые тесты `fetchPool: parses Proxifly JSON array`, `parses NDJSON`, `drops entries missing ip or port`, `drops unknown protocol` (их покрывают тесты `parseProxifly` из Task 1).

Заменить тесты кэша на формат `{ pool, at }` и добавить хелпер для `pickAndValidate` (который дёргает `fetchPool` → 6 fetch):

```js
// Хелпер: ставит в очередь ответы так, что только proxifly (1-й источник) отдаёт
// пул, остальные 5 «падают». Итоговый пул fetchPool === переданные записи.
function queuePool(poolArrayOrText) {
  const text = typeof poolArrayOrText === 'string' ? poolArrayOrText : JSON.stringify(poolArrayOrText);
  mockFetchResponses.push(mockResponse({ text }));                 // proxifly
  for (let i = 1; i < SOURCES.length; i++) mockFetchResponses.push(new Error('source down'));
}

test('fetchPool: память-кэш отдаёт те же данные без повторной сети', async () => {
  __resetMemoryCache();
  queuePool(SAMPLE_POOL);
  const first = await fetchPool({ force: true });
  const callsAfterFirst = mockFetchCalls.length;       // 6 (по источникам)
  const second = await fetchPool();                    // память-кэш
  assert.equal(mockFetchCalls.length, callsAfterFirst);
  assert.equal(second.length, first.length);
});

test('fetchPool: chrome.storage кэш (формат {pool, at}) при холодной памяти', async () => {
  __resetMemoryCache();
  const cachedPool = [{ host: '1.2.3.4', port: 1080, protocol: 'socks5', country: 'NL', score: 100, anonymity: 'elite', httpsCapable: true }];
  mockStorage['freeProxyPoolCache'] = { pool: cachedPool, at: Date.now() - 60_000 };
  const pool = await fetchPool();
  assert.equal(mockFetchCalls.length, 0);              // сеть не трогали
  assert.equal(pool[0].host, '1.2.3.4');
});

test('fetchPool: протухший storage-кэш → сеть', async () => {
  __resetMemoryCache();
  mockStorage['freeProxyPoolCache'] = { pool: [], at: Date.now() - (6 * 60 * 1000) };
  queuePool(SAMPLE_POOL);
  await fetchPool();
  assert.ok(mockFetchCalls.length > 0);
});

test('fetchPool: старый кэш {raw} (до 0.10.0) игнорируется → сеть', async () => {
  __resetMemoryCache();
  mockStorage['freeProxyPoolCache'] = { raw: SAMPLE_POOL, at: Date.now() - 60_000 };  // нет .pool
  queuePool(SAMPLE_POOL);
  await fetchPool();
  assert.ok(mockFetchCalls.length > 0);                // не доверяем старому формату
});
```

В тестах `pickAndValidate` заменить строку постановки пула в очередь. Конкретно, в КАЖДОМ из тестов `pickAndValidate: *` заменить:

```js
mockFetchResponses.push(mockResponse({ text: JSON.stringify(pool) }));  // или onePool
```
на:
```js
queuePool(pool);  // или queuePool(onePool)
```

Затронутые тесты (заменить одну строку постановки пула в каждом):
- `pickAndValidate: first candidate alive …` (`onePool`)
- `pickAndValidate: first 2 dead, 3rd alive …` (`pool`)
- `pickAndValidate: all dead …` (`pool`)
- `pickAndValidate: empty filtered pool …` (`pool`)
- `pickAndValidate: iterates ALL filtered candidates …` (`pool`)
- `pickAndValidate: invokes onProgress …` (`pool`)
- `pickAndValidate: throwing onProgress …` (`pool`)
- `pickAndValidate: caps probes at MAX_VALIDATION_ATTEMPTS` (`pool`)

Тест `pickAndValidate: pool fetch fails → null pick with fetch error` заменить постановку на «все источники падают»:
```js
for (let i = 0; i < SOURCES.length; i++) mockFetchResponses.push(new Error('network down'));
```
(остаётся `assert.match(result.error, /не удалось загрузить список/)` — fetchAllSources бросит, pickAndValidate поймает.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `node --test tests/free-pool.test.js`
Expected: FAIL — `fetchPool` ещё на старом коде / `POOL_URL` undefined / кэш-формат `raw`.

- [ ] **Step 3: Реализовать новый `fetchPool` + удалить устаревшее**

В `extension/lib/free-pool.js` заменить тело `fetchPool` и удалить `parseRaw` и `normalizePool` (заменены адаптерами):

```js
/**
 * Объединённый пул из всех SOURCES. Трёхуровневый кэш: память → chrome.storage
 * → сеть. Кэш хранит УЖЕ нормализованный объединённый массив (не сырой JSON).
 * `force: true` пропускает оба кэша.
 */
export async function fetchPool({ force = false } = {}) {
  const now = Date.now();

  if (!force && memoryPool && (now - memoryFetchedAt) < POOL_TTL_MS) {
    return memoryPool;
  }

  if (!force) {
    try {
      const cached = (await chrome.storage.local.get(POOL_CACHE_KEY))[POOL_CACHE_KEY];
      // Принимаем только новый формат {pool, at}; старый {raw, at} игнорируем.
      if (cached && Array.isArray(cached.pool) && (now - cached.at) < POOL_TTL_MS) {
        memoryPool = cached.pool;
        memoryFetchedAt = cached.at;
        return memoryPool;
      }
    } catch (err) {
      console.warn('[FreePool] Cache read failed:', err.message);
    }
  }

  const pool = await fetchAllSources();
  memoryPool = pool;
  memoryFetchedAt = now;

  try {
    await chrome.storage.local.set({ [POOL_CACHE_KEY]: { pool, at: now } });
  } catch (err) {
    console.warn('[FreePool] Cache write failed:', err.message);
  }

  return memoryPool;
}
```

Удалить функции `parseRaw` и `normalizePool` целиком (их роль теперь у `parseJsonOrNdjson` + `parseProxifly`). Убедиться, что больше нет ссылок на `POOL_URL`, `parseRaw`, `normalizePool` в файле.

- [ ] **Step 4: Запустить — убедиться, что прошло**

Run: `node --test tests/free-pool.test.js`
Expected: PASS — все тесты зелёные.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/free-pool.js tests/free-pool.test.js
git commit -m "feat(free-pool): мультиисточниковый fetchPool с allSettled, дедупом и кэшем нормализованного пула"
```

---

## Task 5: Поднять лимит проверок 30 → 40

Пул стал крупнее и разнообразнее — увеличиваем число кандидатов, проверяемых за один pick.

**Files:**
- Modify: `extension/lib/free-pool.js:27`
- Test: `tests/free-pool.test.js` (тест cap уже использует `MAX_VALIDATION_ATTEMPTS` символически — менять не нужно, но проверить)

- [ ] **Step 1: Изменить константу**

В `extension/lib/free-pool.js` заменить:
```js
export const MAX_VALIDATION_ATTEMPTS = 30;
```
на:
```js
export const MAX_VALIDATION_ATTEMPTS = 40;
```

- [ ] **Step 2: Запустить тесты**

Run: `node --test tests/free-pool.test.js`
Expected: PASS — тест `caps probes at MAX_VALIDATION_ATTEMPTS` использует символ, не число, поэтому остаётся зелёным.

- [ ] **Step 3: Commit**

```bash
git add extension/lib/free-pool.js
git commit -m "feat(free-pool): поднять MAX_VALIDATION_ATTEMPTS до 40 (крупнее пул)"
```

---

## Task 6: Полная верификация набора тестов

**Files:** нет (только запуск)

- [ ] **Step 1: Прогнать ВСЕ тесты**

Run: `cd /c/Users/Konstantin/projects/gemini-unblock && npm test`
Expected: PASS — все файлы (`domain`, `free-pool`, `pac`, `storage`) зелёные. Подтвердить, что тесты `filterPool`, `validateProxy`, `nextLiveProxy` не изменялись и проходят (downstream-контракт сохранён).

- [ ] **Step 2: Если есть падения — починить и перезапустить**

Типичные причины: забытая ссылка на `POOL_URL`/`normalizePool`; в `pickAndValidate`-тесте не заменён `queuePool`. Исправить точечно, повторить `npm test`.

---

## Task 7: README + bump версии

**Files:**
- Modify: `README.md` (секции «Бесплатный пул» RU и EN)
- Modify: `extension/manifest.json:4`, `package.json:3`

- [ ] **Step 1: Обновить README (RU)**

Заменить в `README.md` абзац про источник (текущий пункт 2 секции «B. Бесплатный пул»):
> Расширение тянет публичный список [Proxifly](...) ...

на:
```markdown
2. Расширение тянет несколько публичных списков сразу — [Proxifly](https://github.com/proxifly/free-proxy-list), [ProxyScrape](https://github.com/ProxyScrape/free-proxy-list), [monosans](https://github.com/monosans/proxy-list), [hideip.me](https://github.com/zloi-user/hideip.me) (http+socks5) и [hookzof](https://github.com/hookzof/socks5_list) — объединяет их, отфильтровывает `transparent`-анонимность и страны `RU·BY·CN·IR`, сортирует по доверию/`score`, и последовательно проверяет кандидатов пока не найдёт живой
```

- [ ] **Step 2: Обновить README (EN)**

Заменить аналогичный английский абзац (секция «B. Free pool», пункт 2):
```markdown
2. The extension fetches several public lists at once — [Proxifly](https://github.com/proxifly/free-proxy-list), [ProxyScrape](https://github.com/ProxyScrape/free-proxy-list), [monosans](https://github.com/monosans/proxy-list), [hideip.me](https://github.com/zloi-user/hideip.me) (http+socks5) and [hookzof](https://github.com/hookzof/socks5_list) — merges them, filters out transparent anonymity and `RU·BY·CN·IR`, sorts by trust/`score`, and validates candidates until one works
```

Также обновить строку в секции «## Технологии / ## Tech» при необходимости (упоминание Proxifly как единственного источника — если есть).

- [ ] **Step 3: Bump версии**

В `extension/manifest.json` заменить `"version": "0.9.0"` → `"version": "0.10.0"`.
В `package.json` заменить `"version": "0.9.0"` → `"version": "0.10.0"`.

- [ ] **Step 4: Финальная проверка тестов**

Run: `npm test`
Expected: PASS (README/версия тесты не затрагивают, но прогон обязателен).

- [ ] **Step 5: Commit**

```bash
git add README.md extension/manifest.json package.json
git commit -m "docs: мультиисточниковый пул в README + bump 0.10.0"
```

---

## Self-Review (выполнено автором плана)

**Spec coverage:** реестр 6 источников (Task 3) ✓; адаптеры с ISO-нормализацией country — proxyscrape `country_code`, monosans `iso_code`, hideip имя→ISO (Task 1) ✓; слияние allSettled + дедуп (Task 2, 3) ✓; кэш нормализованного пула + resilience (Task 4) ✓; MAX_VALIDATION_ATTEMPTS (Task 5) ✓; конвейер без изменений — проверяется (Task 6) ✓; README + версия (Task 7) ✓. Тесты на «RU отсеивается filterPool» — покрыто существующими `filterPool`-тестами (блокируемые страны) + `parseMonosans`/`parseHideip` дают корректный ISO, который эти тесты потребляют.

**Placeholder scan:** код приведён полностью в каждом шаге; «TBD» отсутствуют. Веса `defaultScore` заданы конкретными числами в Task 3.

**Type consistency:** `NormalizedProxy` единообразен во всех адаптерах и `dedupePool`; `makeProxy` — единственная точка создания записи; `fetchPool`/`fetchAllSources`/`pickAndValidate` оперируют одним форматом. Кэш-формат `{pool, at}` согласован между `fetchPool` (запись/чтение) и тестами.

**Известный нюанс исполнения:** Task 3 и Task 4 связаны — между ними дерево имеет временно красные `fetchPool`-тесты; коммитятся вместе после Task 4 (отражено в шагах).
