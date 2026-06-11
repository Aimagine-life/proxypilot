import '../lib/compat.js';
import { loadState, saveState } from '../lib/storage.js';
import { parseEntry, ValidationError } from '../lib/domain.js';
import { PRESET_DEFINITIONS, PRESET_ORDER, CATEGORIES } from '../lib/presets.js';

const $ = (sel) => document.querySelector(sel);

let state = null;
let searchQuery = '';            // live preset filter (popup-session only)
const collapsedCats = {};        // { categoryKey: true } — collapsed groups
let pickingFree = false;         // true while a free-pool pick/rotate is running
let lastFreeStateKey = '';       // last rendered free state (drives confetti-on-success)
let confettiRunning = false;     // guards against overlapping confetti bursts
let donateBannerDue = false;     // decided once per popup open in updateDonateNudge()

// Human names for the three proxy sources (state.proxySource).
const SOURCE_LABEL = { manual: 'Свой прокси', own: 'Свой пул', free: 'Бесплатный пул' };
const SOURCE_SHORT = { manual: 'Свой', own: 'Свой пул', free: 'Бесплатный' };

const DONATE_REPEAT_MS = 14 * 24 * 60 * 60 * 1000; // re-show thank-you banner at most every 14 days

// Donate nudge: count "useful" popup opens (proxy enabled + active source) and
// decide ONCE per open whether the thank-you banner is due. renderMain() only
// applies the precomputed decision, so re-renders never re-trigger it.
async function updateDonateNudge() {
  const active = state.enabled && (
    (state.proxySource === 'manual' && state.proxy?.host) ||
    (state.proxySource === 'free' && state.freeProxy?.selected) ||
    (state.proxySource === 'own' && state.ownPool?.selected));
  if (!active) return;

  state.donate.uses += 1;
  if (state.donate.uses >= 3 && !state.donate.dismissed &&
      Date.now() - (state.donate.lastShownAt || 0) >= DONATE_REPEAT_MS) {
    donateBannerDue = true;
    state.donate.lastShownAt = Date.now();
  }
  await persist();
}

async function init() {
  state = await loadState();
  await updateDonateNudge();
  applyTheme();
  await syncResolvedTheme();
  routeInitialScreen();
  bindMain();
  bindSettings();
  bindFirstRun();
  bindThemeSwitcher();
}

const systemDarkMedia = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const pick = state.theme === 'auto'
    ? (systemDarkMedia.matches ? 'dark' : 'light')
    : (state.theme || 'auto');
  const resolved = pick === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
}

async function syncResolvedTheme() {
  const resolved = state.theme === 'auto'
    ? (systemDarkMedia.matches ? 'dark' : 'light')
    : (state.theme === 'dark' ? 'dark' : 'light');
  if (state.resolvedTheme !== resolved) {
    state.resolvedTheme = resolved;
    await persist();
  }
}

function bindThemeSwitcher() {
  for (const pill of document.querySelectorAll('#theme-pills .pill')) {
    pill.addEventListener('click', async () => {
      state.theme = pill.dataset.theme;
      applyTheme();
      await syncResolvedTheme();
      await persist();
      renderThemePills();
    });
  }
  systemDarkMedia.addEventListener('change', async () => {
    if (state.theme !== 'auto') return;
    applyTheme();
    await syncResolvedTheme();
  });
}

function renderThemePills() {
  const active = state.theme || 'auto';
  for (const pill of document.querySelectorAll('#theme-pills .pill')) {
    pill.classList.toggle('active', pill.dataset.theme === active);
  }
}

function routeInitialScreen() {
  const screens = ['main', 'settings', 'firstrun', 'about'];
  for (const s of screens) $(`#screen-${s}`).hidden = true;

  const hasManual = state.proxySource === 'manual' && state.proxy?.host;
  const hasFree = state.proxySource === 'free' && state.freeProxy?.selected;
  const hasOwn = state.proxySource === 'own' && state.ownPool?.selected;
  if (!hasManual && !hasFree && !hasOwn) {
    $('#screen-firstrun').hidden = false;
  } else {
    showMain({ animate: false });
  }
}

// Replay a directional entrance animation on the screen being shown. Removing +
// re-adding the class (with a reflow between) restarts the animation reliably.
function animateScreen(el, dir) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove('anim-left', 'anim-right');
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add(dir === 'forward' ? 'anim-right' : 'anim-left');
}

function showMain({ animate = true } = {}) {
  $('#screen-main').hidden = false;
  $('#screen-settings').hidden = true;
  $('#screen-firstrun').hidden = true;
  $('#screen-about').hidden = true;
  if (animate) animateScreen($('#screen-main'), 'back');
  renderMain();
}

function showSettings() {
  $('#screen-main').hidden = true;
  $('#screen-settings').hidden = false;
  $('#screen-firstrun').hidden = true;
  $('#screen-about').hidden = true;
  animateScreen($('#screen-settings'), 'forward');
  renderSettings();
}

function showAbout() {
  $('#screen-main').hidden = true;
  $('#screen-settings').hidden = true;
  $('#screen-firstrun').hidden = true;
  $('#screen-about').hidden = false;
  animateScreen($('#screen-about'), 'forward');
  const v = $('#about-version');
  if (v) v.textContent = 'v' + chrome.runtime.getManifest().version;
}

function renderMain() {
  // Status line — glanceable routing state (friendly, no raw IP in the headline).
  const status = $('#status-line');
  status.classList.remove('no-dot', 'amber', 'error');
  if (!state.enabled) {
    status.textContent = 'Выключено';
    status.classList.add('no-dot');
  } else if (!state.proxy?.host) {
    status.textContent = 'Нужна настройка прокси';
    status.classList.add('amber');
  } else {
    const src = SOURCE_SHORT[state.proxySource] || 'Свой';
    const t = state.proxy?.lastTest;
    if (t?.ok) {
      const cc = String(t.country || '').toUpperCase();
      const flag = cc ? ` · ${countryFlag(cc)}` : '';
      status.textContent = `${src}${flag}${t.latencyMs ? ` · ${t.latencyMs} мс` : ''}`;
    } else {
      status.textContent = `${src} · ${state.proxy.host}:${state.proxy.port}`;
    }
  }

  $('#master-toggle').checked = !!state.enabled;

  // RKN compliance banner
  const rknResults = state.rknResults || {};
  const blockedNames = [];
  for (const key of PRESET_ORDER) {
    const def = PRESET_DEFINITIONS[key];
    const isBlocked = (def.domains || []).some((d) => rknResults[d]?.blocked);
    if (isBlocked) blockedNames.push(def.label);
  }
  const banner = $('#rkn-banner');
  if (blockedNames.length) {
    $('#rkn-text').textContent =
      `${blockedNames.join(', ')} — в реестре Роскомнадзора. Маршрутизация отключена согласно 149-ФЗ.`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }

  // Preset grid — grouped by category. Search filters live; enabled presets sort
  // to the top of each group; group headers collapse.
  const grid = $('#preset-grid');
  grid.replaceChildren();
  const q = searchQuery.trim().toLowerCase();
  let totalShown = 0;
  let enabledTotal = 0;

  for (const cat of CATEGORIES) {
    let keys = PRESET_ORDER.filter((k) => PRESET_DEFINITIONS[k].category === cat.key);
    if (!keys.length) continue;

    const catEnabled = keys.filter((k) => state.presets[k]?.enabled).length;
    enabledTotal += catEnabled;

    // Enabled first, then original preset order.
    keys = keys.slice().sort((a, b) =>
      (state.presets[b]?.enabled ? 1 : 0) - (state.presets[a]?.enabled ? 1 : 0));

    const matched = q
      ? keys.filter((k) => {
          const d = PRESET_DEFINITIONS[k];
          return d.label.toLowerCase().includes(q)
            || (d.domains || []).some((dm) => dm.toLowerCase().includes(q));
        })
      : keys;
    if (!matched.length) continue;

    const collapsed = !q && !!collapsedCats[cat.key];

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'cat-header' + (collapsed ? ' collapsed' : '');
    const caret = document.createElement('span');
    caret.className = 'cat-caret';
    caret.textContent = '▾';
    const name = document.createElement('span');
    name.className = 'cat-name';
    name.textContent = cat.label;
    const count = document.createElement('span');
    count.className = 'cat-count';
    count.textContent = catEnabled ? `${catEnabled} вкл` : '';
    header.append(caret, name, count);
    header.addEventListener('click', () => {
      collapsedCats[cat.key] = !collapsedCats[cat.key];
      renderMain();
    });
    grid.appendChild(header);

    if (collapsed) continue;
    for (const key of matched) {
      grid.appendChild(makeCard(key, rknResults));
      totalShown++;
    }
  }

  $('#preset-empty').hidden = totalShown > 0 || !q;
  const countEl = $('#enabled-count');
  if (countEl) countEl.textContent = enabledTotal ? ` · ${enabledTotal} включено` : '';
  const resetBtn = $('#reset-presets');
  if (resetBtn) resetBtn.hidden = enabledTotal === 0;

  // Custom domains list
  const list = $('#custom-list');
  list.replaceChildren();
  for (const entry of state.customDomains || []) {
    const item = document.createElement('div');
    item.className = 'custom-item';
    const display = entry.mode === 'wildcard'
      ? `*.${entry.value}`
      : entry.mode === 'exact' ? `=${entry.value}` : entry.value;
    const dot = document.createElement('div');
    dot.className = 'dot';
    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = display;
    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.type = 'button';
    remove.title = 'Remove';
    remove.textContent = '\u00d7';
    remove.addEventListener('click', () => removeCustom(entry));
    item.append(dot, value, remove);
    list.appendChild(item);
  }

  // Free-pool danger banner — public free proxies are untrusted. Warn whenever
  // ANYTHING is actually routed through one (any preset or custom domain), not
  // just Google-AI services.
  const aiBanner = $('#ai-free-banner');
  if (aiBanner) {
    const anyRouted = PRESET_ORDER.some((k) => state.presets[k]?.enabled)
      || (state.customDomains || []).length > 0;
    aiBanner.hidden = !(state.proxySource === 'free' && state.enabled && anyRouted);
  }

  $('#donate-banner').hidden = !donateBannerDue;
}

function bindMain() {
  $('#master-toggle').addEventListener('change', async (e) => {
    state.enabled = e.target.checked;
    await persist();
    renderMain();
  });

  $('#open-settings').addEventListener('click', () => showSettings());
  $('#open-about').addEventListener('click', () => showAbout());
  $('#back-from-about').addEventListener('click', () => showMain());

  $('#donate-banner-close').addEventListener('click', async () => {
    state.donate.dismissed = true;
    donateBannerDue = false;
    await persist();
    renderMain();
  });
  // Клик по «Поддержать» = пользователь отреагировал — баннер больше не нужен
  // (постоянная кнопка в футере остаётся). Переходу по ссылке не мешаем.
  $('#donate-banner-link').addEventListener('click', () => {
    state.donate.dismissed = true;
    donateBannerDue = false;
    persist();
  });

  $('#preset-search').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderMain();
  });

  $('#reset-presets').addEventListener('click', async () => {
    for (const k of PRESET_ORDER) {
      if (state.presets[k]) state.presets[k].enabled = false;
    }
    await persist();
    renderMain();
  });

  $('#add-domain-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#add-domain-input');
    const errEl = $('#add-domain-error');
    const btn = $('#add-domain-btn');
    errEl.hidden = true;

    let entry;
    try {
      entry = parseEntry(input.value);
    } catch (err) {
      if (err instanceof ValidationError) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        return;
      }
      throw err;
    }

    // Dedupe
    const exists = (state.customDomains || []).find(
      (x) => x.value === entry.value && x.mode === entry.mode
    );
    if (exists) {
      errEl.textContent = '\u0423\u0436\u0435 \u0432 \u0441\u043f\u0438\u0441\u043a\u0435';
      errEl.hidden = false;
      return;
    }

    // RKN compliance check
    btn.disabled = true;
    btn.textContent = '\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430\u2026';
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'CHECK_DOMAIN',
        domain: entry.value,
      });
      if (result?.blocked) {
        errEl.textContent = `\u26d4 ${entry.value} \u0432 \u0440\u0435\u0435\u0441\u0442\u0440\u0435 \u0420\u043e\u0441\u043a\u043e\u043c\u043d\u0430\u0434\u0437\u043e\u0440\u0430 \u2014 \u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043d\u0435\u043b\u044c\u0437\u044f (149-\u0424\u0417)`;
        errEl.hidden = false;
        return;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '+ \u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c';
    }

    state.customDomains = state.customDomains || [];
    state.customDomains.push(entry);
    await persist();
    input.value = '';
    renderMain();

    showToast(`\u2713 ${entry.value} \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d \u2014 \u043d\u0435 \u0432 \u0440\u0435\u0435\u0441\u0442\u0440\u0435 \u0420\u041a\u041d`);
  });
}

// Build one preset card. Full-colour brand logo with an emoji glyph fallback
// (CSP-safe: listener attached via JS, no inline handlers).
function makeCard(key, rknResults) {
  const def = PRESET_DEFINITIONS[key];
  const stored = state.presets[key];
  const isBlocked = (def.domains || []).some((d) => rknResults[d]?.blocked);
  const card = document.createElement('div');
  card.className = 'preset-card'
    + (stored?.enabled ? ' on' : '')
    + (isBlocked ? ' rkn-blocked' : '');
  card.dataset.key = key;

  let mark;
  if (def.logo) {
    mark = document.createElement('img');
    mark.className = 'logo';
    mark.src = `../icons/brands/${def.logo}`;
    mark.alt = '';
    mark.draggable = false;
    mark.addEventListener('error', () => {
      const fb = document.createElement('div');
      fb.className = 'icon';
      fb.textContent = def.icon;
      mark.replaceWith(fb);
    });
  } else {
    mark = document.createElement('div');
    mark.className = 'icon';
    mark.textContent = def.icon;
  }
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = def.label;
  card.append(mark, label);

  if (!isBlocked) card.addEventListener('click', () => togglePreset(key));
  return card;
}

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2400);
}

async function removeCustom(entry) {
  state.customDomains = (state.customDomains || []).filter(
    (x) => !(x.value === entry.value && x.mode === entry.mode)
  );
  await persist();
  renderMain();
}

async function togglePreset(key) {
  state.presets[key].enabled = !state.presets[key].enabled;
  await persist();
  renderMain();
}

async function persist() {
  await saveState(state);
}

// --- Settings screen ---

function bindSettings() {
  $('#back-to-main').addEventListener('click', () => showMain());

  for (const pill of document.querySelectorAll('#scheme-pills .pill')) {
    pill.addEventListener('click', async () => {
      const scheme = pill.dataset.scheme;
      ensureProxyObject();
      if (scheme === 'auto') {
        state.proxy.scheme = 'auto';
        mirrorManual();
        await persist();
        renderSettings();
        await autoDetectScheme();
      } else {
        state.proxy.scheme = scheme;
        mirrorManual();
        await persist();
        renderSettings();
      }
    });
  }

  // Auto-parse proxy URL when pasted/typed into host field.
  const hostEl = $('#cfg-host');
  hostEl.addEventListener('blur', async () => {
    ensureProxyObject();
    const raw = hostEl.value.trim();
    const parsed = tryParseProxyUrl(raw);
    if (parsed) {
      state.proxy.host = parsed.host;
      if (parsed.port) state.proxy.port = parsed.port;
      if (parsed.scheme) state.proxy.scheme = parsed.scheme;
      if (parsed.user) state.proxy.user = parsed.user;
      if (parsed.pass !== undefined) state.proxy.pass = parsed.pass;
      // If URL had no explicit scheme (provider format), auto-detect.
      if (!parsed.scheme) {
        state.proxy.scheme = 'auto';
      }
      mirrorManual();
      await persist();
      renderSettings();
      if (state.proxy.scheme === 'auto' && state.proxy.host && state.proxy.port) {
        await autoDetectScheme();
      }
    } else {
      state.proxy.host = raw;
      mirrorManual();
      await persist();
    }
  });

  const otherFields = [
    ['#cfg-port', 'port', (v) => parseInt(v, 10) || 0],
    ['#cfg-user', 'user', (v) => v],
    ['#cfg-pass', 'pass', (v) => v],
  ];
  for (const [sel, key, parse] of otherFields) {
    const el = $(sel);
    el.addEventListener('blur', async () => {
      ensureProxyObject();
      state.proxy[key] = parse(el.value);
      mirrorManual();
      await persist();
    });
  }

  // Source toggle (Manual / Free pool). Switch the tab OPTIMISTICALLY so the UI
  // reacts instantly: picking a working free proxy (pickAndValidate) can take tens
  // of seconds, and we must never leave the pills disabled/unresponsive while it
  // runs (that's what looked like "Бесплатный пул doesn't click").
  for (const pill of document.querySelectorAll('#source-pills .pill')) {
    pill.addEventListener('click', async () => {
      const source = pill.dataset.source;
      if (state.proxySource === source) return;

      // Instant feedback — flip the active tab and show the right block now.
      state.proxySource = source;
      // A real pick only runs when switching to the free pool with nothing chosen
      // yet — drive the searching state for that case (renderFreeBlock reads it).
      if (source === 'free' && !state.freeProxy?.selected) pickingFree = true;
      renderSettings();

      try {
        const res = await chrome.runtime.sendMessage({ type: 'SWITCH_SOURCE', source });
        pickingFree = false;
        if (res?.state) state = res.state;
        else if (res?.error && source === 'free' && state.freeProxy) state.freeProxy.lastError = res.error;
        renderSettings();
      } catch (err) {
        pickingFree = false;
        if (source === 'free' && state.freeProxy) state.freeProxy.lastError = err.message;
        renderSettings();
      }
    });
  }

  $('#rotate-free').addEventListener('click', async () => {
    if (pickingFree) return;            // a pick is already running
    pickingFree = true;
    renderSettings();                   // show the searching state immediately
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ROTATE_FREE' });
      pickingFree = false;
      if (res?.state) {
        state = res.state;
      } else if (res?.error && state.freeProxy) {
        state.freeProxy.lastError = res.error;
        state.freeProxy.selected = null;
      }
      renderSettings();
    } catch (err) {
      pickingFree = false;
      if (state.freeProxy) state.freeProxy.lastError = err.message;
      renderSettings();
    }
  });

  $('#test-proxy').addEventListener('click', () => runTest('TEST_PROXY'));
  $('#test-service').addEventListener('click', () => runTest('TEST_SERVICE'));

  // Own pool: save the list (parsed in the popup) and connect to the first one.
  $('#save-own').addEventListener('click', async () => {
    const raw = $('#own-list').value;
    const proxies = parseProxyList(raw);
    $('#own-meta').textContent = proxies.length
      ? `${proxies.length} прокси распознано`
      : 'Не распознал ни одного прокси — проверь формат';
    const res = await chrome.runtime.sendMessage({ type: 'SET_OWN_POOL', raw, proxies });
    if (res?.state) { state = res.state; renderSettings(); }
  });

  $('#rotate-own').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'ROTATE_OWN' });
    if (res?.state) state = res.state;
    else if (res?.error && state.ownPool) state.ownPool.lastError = res.error;
    renderSettings();
  });
}

function renderSettings() {
  ensureProxyObject();

  // Active-source anchor + source pills
  renderActiveSource();
  for (const pill of document.querySelectorAll('#source-pills .pill')) {
    pill.classList.toggle('active', pill.dataset.source === (state.proxySource || 'manual'));
  }

  const isFree = state.proxySource === 'free';
  const isOwn = state.proxySource === 'own';
  $('#manual-blocks').hidden = isFree || isOwn;
  $('#free-block').hidden = !isFree;
  $('#own-block').hidden = !isOwn;

  // Manual fields
  $('#cfg-host').value = state.proxy?.host || '';
  $('#cfg-port').value = state.proxy?.port || '';
  $('#cfg-user').value = state.proxy?.user || '';
  $('#cfg-pass').value = state.proxy?.pass || '';
  for (const pill of document.querySelectorAll('#scheme-pills .pill')) {
    pill.classList.toggle('active', pill.dataset.scheme === state.proxy?.scheme);
  }

  // Free-block render
  if (isFree) renderFreeBlock();

  // Own-pool render
  if (isOwn) renderOwnBlock();

  renderThemePills();
  $('#test-result').hidden = true;
}

function countryFlag(cc) {
  if (!cc || cc.length !== 2) return '';
  const upper = cc.toUpperCase();
  const A = 0x41, base = 0x1F1E6;
  return String.fromCodePoint(base + upper.charCodeAt(0) - A, base + upper.charCodeAt(1) - A);
}

// Render the free-pool status card as a small state machine:
// idle → searching → found (confetti) → error. Reads pickingFree + state.freeProxy.
function renderFreeBlock() {
  const rotate = $('#rotate-free');
  const sel = state.freeProxy?.selected;
  const err = state.freeProxy?.lastError;

  if (pickingFree) {
    setStatusCard('free', 'searching', {
      title: 'Подбираю рабочий прокси…',
      sub: 'Проверяю кандидатов вживую — это пара секунд.',
      progress: { pct: 0, text: 'Запускаю проверку…' },
    });
    if (rotate) { rotate.disabled = true; rotate.textContent = 'Идёт подбор…'; }
    lastFreeStateKey = 'searching';
  } else if (sel) {
    const country = sel.country
      ? `${countryFlag(sel.country)} ${regionName(sel.country) || sel.country}`
      : null;
    const ms = sel.latencyMs;
    const speed = typeof ms === 'number'
      ? (ms < 600 ? { cls: 'speed-fast', label: 'быстрый' }
        : ms < 1800 ? { cls: 'speed-mid', label: 'средний' }
        : { cls: 'speed-slow', label: 'медленный' })
      : null;
    const proto = ({ http: 'HTTP', https: 'HTTPS', socks5: 'SOCKS5', socks4: 'SOCKS4' })[sel.scheme] || sel.scheme;
    const badges = [];
    if (country) badges.push({ text: country });
    if (speed) badges.push({ text: `⚡ ${ms} мс · ${speed.label}`, cls: speed.cls });
    if (proto) badges.push({ text: proto });

    setStatusCard('free', 'found', {
      title: 'Готово — прокси подключён',
      sub: `${sel.host}:${sel.port}`,
      badges,
    });
    if (rotate) { rotate.disabled = false; rotate.textContent = '↻ Сменить прокси'; }

    const key = `found:${sel.host}:${sel.port}`;
    // Celebrate only on a real transition INTO a found proxy (after a search, or a
    // rotate to a different one) — never on plain settings re-renders / reopen.
    if (lastFreeStateKey === 'searching' ||
        (lastFreeStateKey.startsWith('found:') && lastFreeStateKey !== key)) {
      burstConfetti();
    }
    lastFreeStateKey = key;
  } else if (err) {
    setStatusCard('free', 'error', { title: 'Живой прокси пока не нашёлся', sub: err });
    if (rotate) { rotate.disabled = false; rotate.textContent = '↻ Попробовать ещё раз'; }
    lastFreeStateKey = 'error';
  } else {
    setStatusCard('free', 'idle', {
      title: 'Прокси ещё не подобран',
      sub: 'Нажми кнопку — найду рабочий за пару секунд.',
    });
    if (rotate) { rotate.disabled = false; rotate.textContent = 'Подобрать прокси'; }
    lastFreeStateKey = 'idle';
  }

  const fetchedAt = state.freeProxy?.poolFetchedAt;
  $('#free-pool-meta').textContent = fetchedAt
    ? `Список обновлён ${Math.floor((Date.now() - fetchedAt) / 60_000)} мин назад`
    : '';
}

// Apply a state to the free-pool card: data-state + icon + texts + optional
// progress bar and detail badges.
const STATE_ICONS = { idle: '🔍', searching: '', found: '✓', error: '😕' };

// Generic status card shared by the free-pool and own-pool blocks. `prefix` maps
// to element ids (#${prefix}-state / -icon / -title / -sub / -progress / -bar-fill
// / -progress-text / -badges). `icon` overrides the default per-state glyph.
function setStatusCard(prefix, stateName, { title = '', sub = '', progress = null, badges = null, icon = null } = {}) {
  const root = $(`#${prefix}-state`);
  if (!root) return;
  root.dataset.state = stateName;

  const iconEl = $(`#${prefix}-icon`);
  const titleEl = $(`#${prefix}-title`);
  const subEl = $(`#${prefix}-sub`);
  const prog = $(`#${prefix}-progress`);
  const wrap = $(`#${prefix}-badges`);

  if (iconEl) iconEl.textContent = icon != null ? icon : (STATE_ICONS[stateName] ?? '');
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = sub;

  if (prog) {
    if (progress) {
      prog.hidden = false;
      const fill = $(`#${prefix}-bar-fill`);
      const txt = $(`#${prefix}-progress-text`);
      if (fill) fill.style.width = `${progress.pct}%`;
      if (txt) txt.textContent = progress.text;
    } else {
      prog.hidden = true;
    }
  }

  if (wrap) {
    if (badges && badges.length) {
      wrap.hidden = false;
      wrap.textContent = '';
      for (const b of badges) {
        const el = document.createElement('span');
        el.className = b.cls ? `free-badge ${b.cls}` : 'free-badge';
        el.textContent = b.text;
        wrap.appendChild(el);
      }
    } else {
      wrap.hidden = true;
    }
  }
}

// Render the always-visible "Сейчас работает" anchor at the top of settings, so
// the active source is unambiguous no matter which tab you're configuring.
function renderActiveSource() {
  const card = $('#active-source');
  if (!card) return;
  const nameEl = $('#active-source-name');
  const detailEl = $('#active-source-detail');
  const src = state.proxySource || 'manual';
  const label = SOURCE_LABEL[src] || 'Свой прокси';

  if (!state.enabled) {
    card.dataset.state = 'off';
    nameEl.textContent = 'Выключено';
    detailEl.textContent = `Выбран: ${label} · включи переключатель на главном экране`;
    return;
  }

  const p = state.proxy;
  if (p?.host) {
    card.dataset.state = 'on';
    nameEl.textContent = label;
    const cc = String(p.lastTest?.country || '').toUpperCase();
    const place = cc ? ` · ${countryFlag(cc)} ${regionName(cc) || cc}` : '';
    detailEl.textContent = `${p.host}:${p.port}${place}`;
  } else {
    card.dataset.state = 'warn';
    nameEl.textContent = label;
    detailEl.textContent = src === 'free'
      ? 'Прокси ещё не подобран — нажми «Подобрать» ниже'
      : src === 'own'
        ? 'Прокси не выбран — добавь список ниже'
        : 'Прокси не настроен — заполни поля ниже';
  }
}

// Render the proxy/service test result as a status card (icon + title + sub +
// badges), in the same visual language as the pool cards. kind: ok | warn | err.
function renderTestCard(kind, { title, sub = '', badges = [] }) {
  const result = $('#test-result');
  if (!result) return;
  result.hidden = false;
  result.className = `test-card test-${kind}`;
  const icon = { ok: '✓', warn: '⚠', err: '✗' }[kind] || '';
  const iconEl = document.createElement('div');
  iconEl.className = 'free-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  const body = document.createElement('div');
  body.className = 'free-body';
  const titleEl = document.createElement('div');
  titleEl.className = 'free-title';
  titleEl.textContent = title;
  body.appendChild(titleEl);
  if (sub) {
    const subEl = document.createElement('div');
    subEl.className = 'free-sub';
    subEl.textContent = sub;
    body.appendChild(subEl);
  }
  if (badges.length) {
    const wrap = document.createElement('div');
    wrap.className = 'free-badges';
    for (const b of badges) {
      const span = document.createElement('span');
      span.className = b.cls ? `free-badge ${b.cls}` : 'free-badge';
      span.textContent = b.text;
      wrap.appendChild(span);
    }
    body.appendChild(wrap);
  }
  result.replaceChildren(iconEl, body);
}

// Render the own-pool status card: empty list → idle, active proxy → found,
// all-dead → error. Same status-card language as the free pool.
function renderOwnBlock() {
  const op = state.ownPool || {};
  $('#own-list').value = op.raw || '';
  const n = (op.proxies || []).length;
  $('#own-meta').textContent = n ? `${n} прокси в списке` : '';

  const rotate = $('#rotate-own');
  const protoLabel = (s) => ({ http: 'HTTP', https: 'HTTPS', socks5: 'SOCKS5', socks4: 'SOCKS4' })[s] || (s || 'HTTP').toUpperCase();

  if (op.selected) {
    const badges = [{ text: protoLabel(op.selected.scheme) }];
    if (n > 1) badges.push({ text: `1 из ${n} в пуле` });
    setStatusCard('own', 'found', {
      title: 'Прокси активен',
      sub: `${op.selected.host}:${op.selected.port}`,
      badges,
    });
    if (rotate) rotate.disabled = false;
  } else if (op.lastError) {
    setStatusCard('own', 'error', { icon: '😕', title: 'Прокси недоступен', sub: op.lastError });
    if (rotate) rotate.disabled = false;
  } else if (n > 0) {
    setStatusCard('own', 'idle', { icon: '📋', title: `${n} прокси готово`, sub: 'Нажми «Сохранить и подключить».' });
    if (rotate) rotate.disabled = false;
  } else {
    setStatusCard('own', 'idle', { icon: '📋', title: 'Список пуст', sub: 'Вставь свои прокси — по одному на строку.' });
    if (rotate) rotate.disabled = true;
  }
}

// Celebratory confetti burst when a fresh live proxy is found. Pure canvas, no
// deps; respects reduced-motion; self-clears after the animation.
function burstConfetti() {
  if (confettiRunning || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = $('#confetti');
  if (!canvas) return;
  confettiRunning = true;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth || 360;
  const H = canvas.height = canvas.offsetHeight || 560;
  const colors = ['#10b981', '#6366f1', '#06b6d4', '#f59e0b', '#34d399'];
  const N = 90;
  const parts = [];
  for (let i = 0; i < N; i++) {
    const speed = 5 + (i % 7);
    parts.push({
      x: W / 2 + (i % 11 - 5) * 4,
      y: H * 0.40,
      vx: (i % 2 ? 1 : -1) * (1 + (i % 6)) * 0.7,
      vy: -speed - (i % 4),
      g: 0.22 + (i % 5) * 0.02,
      size: 4 + (i % 4),
      rot: (i / N) * Math.PI * 2,
      vr: (i % 2 ? 1 : -1) * 0.18,
      color: colors[i % colors.length],
      rect: i % 2 === 0,
    });
  }
  canvas.style.opacity = '1';
  const start = performance.now();
  const DUR = 1400;
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = t > DUR * 0.6 ? Math.max(0, 1 - (t - DUR * 0.6) / (DUR * 0.4)) : 1;
    for (const p of parts) {
      p.vy += p.g; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.rect) ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (t < DUR) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, W, H); canvas.style.opacity = '0'; confettiRunning = false; }
  }
  requestAnimationFrame(frame);
}

// Country code → Russian name, e.g. 'NL' → 'Нидерланды'. Falls back to '' on
// unknown/invalid codes.
let _regionNames;
function regionName(cc) {
  if (!cc || cc.length !== 2) return '';
  try {
    _regionNames = _regionNames || new Intl.DisplayNames(['ru'], { type: 'region' });
    return _regionNames.of(cc.toUpperCase()) || '';
  } catch {
    return '';
  }
}

/**
 * Try to parse a proxy string. Supported formats:
 *   - socks5://user:pass@host:port  (URL style)
 *   - http://host:port
 *   - host:port:user:pass            (provider style, e.g. 196.16.109.114:8000:N0eT6k:UK2c2X)
 *   - host:port
 * Returns { scheme?, host, port?, user?, pass? } or null if it's just a plain hostname.
 */
function tryParseProxyUrl(input) {
  const SCHEMES = { http: 'http', https: 'https', socks5: 'socks5', socks4: 'socks4', socks: 'socks5' };

  // --- Provider format: host:port:user:pass ---
  // Detect by splitting on colons: 4 parts where part[1] is a number.
  const hasScheme = /^[a-z][a-z0-9]*:\/\//i.test(input);
  if (!hasScheme) {
    const parts = input.trim().split(':');
    if (parts.length === 4 && /^\d+$/.test(parts[1])) {
      // Provider format: no scheme → auto-detect will determine it
      return {
        host: parts[0],
        port: parseInt(parts[1], 10),
        user: parts[2],
        pass: parts[3],
      };
    }
    // host:port only
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      return { host: parts[0], port: parseInt(parts[1], 10) };
    }
  }

  // --- URL format: scheme://user:pass@host:port ---
  if (!hasScheme) return null;

  let scheme = null;
  let rest = input;

  const schemeMatch = input.match(/^([a-z][a-z0-9]*):\/\//i);
  if (schemeMatch) {
    scheme = SCHEMES[schemeMatch[1].toLowerCase()] || null;
    rest = input.slice(schemeMatch[0].length);
  }

  let user = null;
  let pass = undefined;
  const atIdx = rest.indexOf('@');
  if (atIdx !== -1) {
    const userinfo = rest.slice(0, atIdx);
    rest = rest.slice(atIdx + 1);
    const colonIdx = userinfo.indexOf(':');
    if (colonIdx !== -1) {
      user = decodeURIComponent(userinfo.slice(0, colonIdx));
      pass = decodeURIComponent(userinfo.slice(colonIdx + 1));
    } else {
      user = decodeURIComponent(userinfo);
    }
  }

  rest = rest.split(/[/?#]/)[0];
  let host = rest;
  let port = null;
  const portMatch = rest.match(/:(\d+)$/);
  if (portMatch) {
    port = parseInt(portMatch[1], 10);
    host = rest.slice(0, -portMatch[0].length);
  }

  if (!host) return null;

  const result = { host };
  if (scheme) result.scheme = scheme;
  if (port) result.port = port;
  if (user) result.user = user;
  if (pass !== undefined) result.pass = pass;
  return result;
}

// Parse a textarea of proxies (one per line) into [{host,port,scheme,user,pass}].
// Skips blank/unparseable lines. No scheme → defaults to http.
function parseProxyList(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const p = tryParseProxyUrl(s);
    if (p && p.host && p.port) {
      out.push({
        host: p.host,
        port: Number(p.port),
        scheme: p.scheme || 'http',
        user: p.user || '',
        pass: p.pass || '',
      });
    }
  }
  return out;
}

function ensureProxyObject() {
  if (!state.proxy) {
    state.proxy = { host: '', port: 0, scheme: 'auto', user: '', pass: '' };
  }
}

async function autoDetectScheme() {
  if (!state.proxy?.host || !state.proxy?.port) return;

  const result = $('#test-result');
  const autoPill = document.querySelector('.pill[data-scheme="auto"]');
  result.hidden = false;
  result.className = 'result-block detecting';
  result.textContent = '\u25f7 \u041e\u043f\u0440\u0435\u0434\u0435\u043b\u044f\u0435\u043c\u2026 HTTP';
  if (autoPill) autoPill.classList.add('detecting');

  // Fire-and-forget to background. Popup watches storage for live updates.
  chrome.runtime.sendMessage({
    type: 'DETECT_SCHEME',
    host: state.proxy.host,
    port: state.proxy.port,
    user: state.proxy.user || '',
    pass: state.proxy.pass || '',
  });
}

// Receive live progress from background's pickAndValidate. Guarded by pickingFree
// so a late/stray message can never overwrite the final found/error card (that
// race is what made a successful pick look like the search had stalled).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'FREE_PROGRESS' || !pickingFree) return;
  const fill = $('#free-bar-fill');
  const text = $('#free-progress-text');
  const prog = $('#free-progress');
  if (prog) prog.hidden = false;
  if (fill) fill.style.width = `${Math.round((msg.index / msg.total) * 100)}%`;
  if (text) text.textContent = `Проверено ${msg.index} из ${msg.total} · ${msg.host}:${msg.port}`;
});

// Watch storage changes for detect progress + general state updates.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.state) return;
  const newState = changes.state.newValue;
  if (!newState) return;
  state = newState;
  applyTheme();
  renderThemePills();

  const ds = state.detectStatus;
  const result = $('#test-result');
  const autoPill = document.querySelector('.pill[data-scheme="auto"]');

  if (ds?.running) {
    result.hidden = false;
    result.className = 'result-block detecting';
    result.textContent = `\u25f7 \u041e\u043f\u0440\u0435\u0434\u0435\u043b\u044f\u0435\u043c\u2026 ${ds.trying?.toUpperCase() || ''}`;
    if (autoPill) autoPill.classList.add('detecting');
  } else if (ds && !ds.running) {
    if (autoPill) autoPill.classList.remove('detecting');
    result.hidden = false;
    if (ds.ok) {
      result.className = 'result-block ok';
      result.textContent = `\u2713 \u041d\u0430\u0439\u0434\u0435\u043d: ${ds.scheme.toUpperCase()}`;
      renderSettings();
    } else {
      result.className = 'result-block err';
      result.textContent = `\u2717 ${ds.error || '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c'}`;
    }
  }
});

async function runTest(type) {
  const btnProxy = $('#test-proxy');
  const btnService = $('#test-service');
  const result = $('#test-result');

  // \u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0441\u0435\u0440\u0432\u0438\u0441\u0430 \u2014 \u0431\u0435\u0440\u0451\u043c \u043f\u0435\u0440\u0432\u044b\u0439 \u0432\u043a\u043b\u044e\u0447\u0451\u043d\u043d\u044b\u0439 \u043f\u0440\u0435\u0441\u0435\u0442 \u0438 \u0442\u0435\u0441\u0442\u0438\u043c \u0435\u0433\u043e \u0434\u043e\u043c\u0435\u043d.
  let target = null;
  if (type === 'TEST_SERVICE') {
    const key = PRESET_ORDER.find((k) => state.presets[k]?.enabled);
    if (!key) {
      result.hidden = false;
      result.className = 'result-block err';
      result.textContent = '\u2717 \u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u043a\u043b\u044e\u0447\u0438\u0442\u0435 \u0445\u043e\u0442\u044f \u0431\u044b \u043e\u0434\u0438\u043d \u0441\u0435\u0440\u0432\u0438\u0441';
      return;
    }
    const def = PRESET_DEFINITIONS[key];
    target = { domain: def.domains[0], label: def.label };
  }

  btnProxy.disabled = true;
  btnService.disabled = true;
  result.hidden = true;

  try {
    const res = await chrome.runtime.sendMessage(
      type === 'TEST_SERVICE' ? { type, domain: target.domain } : { type },
    );
    if (res.ok) {
      if (type === 'TEST_PROXY') {
        const cc = String(res.country || '').toUpperCase();
        const place = `${countryFlag(cc)} ${regionName(cc) || cc || '\u2014'}`.trim();
        const localProxy = cc === 'RU'; // \u0440\u043e\u0441\u0441\u0438\u0439\u0441\u043a\u0438\u0439 \u043f\u0440\u043e\u043a\u0441\u0438 \u2014 \u0420\u0424 \u0433\u0435\u043e-\u0431\u043b\u043e\u043a \u0438\u043c \u043d\u0435 \u043e\u0431\u043e\u0439\u0442\u0438
        const badges = [{ text: place }, { text: `\u26a1 ${res.latencyMs} \u043c\u0441` }, { text: `IP ${res.ip || '?'}` }];
        if (localProxy) {
          renderTestCard('warn', {
            title: '\u042d\u0442\u043e \u0440\u043e\u0441\u0441\u0438\u0439\u0441\u043a\u0438\u0439 \u043f\u0440\u043e\u043a\u0441\u0438',
            sub: '\u0413\u0435\u043e-\u0431\u043b\u043e\u043a \u0438\u043c \u043d\u0435 \u043e\u0431\u043e\u0439\u0442\u0438 \u2014 \u043d\u0443\u0436\u0435\u043d \u043f\u0440\u043e\u043a\u0441\u0438 \u0434\u0440\u0443\u0433\u043e\u0439 \u0441\u0442\u0440\u0430\u043d\u044b.',
            badges,
          });
        } else {
          renderTestCard('ok', {
            title: '\u041f\u0440\u043e\u043a\u0441\u0438 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442',
            sub: '\u0417\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0435 \u0441\u0435\u0440\u0432\u0438\u0441\u044b \u043e\u0442\u043a\u0440\u043e\u044e\u0442\u0441\u044f.',
            badges,
          });
        }
      } else {
        renderTestCard('ok', {
          title: `${target.label} \u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442`,
          badges: [{ text: `HTTP ${res.httpStatus}` }, { text: `\u26a1 ${res.latencyMs} \u043c\u0441` }],
        });
      }
      state = await loadState();
    } else {
      renderTestCard('err', { title: '\u041d\u0435 \u043f\u043e\u043b\u0443\u0447\u0438\u043b\u043e\u0441\u044c', sub: res.error });
    }
  } finally {
    btnProxy.disabled = false;
    btnService.disabled = false;
  }
}

// --- First-run screen ---

function bindFirstRun() {
  $('#firstrun-open-settings').addEventListener('click', () => {
    ensureProxyObject();
    showSettings();
  });
}

function mirrorManual() {
  if (state.proxySource !== 'manual') return;
  if (!state.proxy) return;
  state.manualProxy = { ...state.proxy };
  delete state.manualProxy.lastTest; // lastTest belongs on active proxy only
}

init();
