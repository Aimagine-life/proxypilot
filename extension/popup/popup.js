import { loadState, saveState } from '../lib/storage.js';
import { parseEntry, ValidationError } from '../lib/domain.js';
import { PRESET_DEFINITIONS, PRESET_ORDER, AI_PRESET_KEYS, CATEGORIES } from '../lib/presets.js';

const $ = (sel) => document.querySelector(sel);

let state = null;

async function init() {
  state = await loadState();
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
  const screens = ['main', 'settings', 'firstrun'];
  for (const s of screens) $(`#screen-${s}`).hidden = true;

  const hasManual = state.proxySource === 'manual' && state.proxy?.host;
  const hasFree = state.proxySource === 'free' && state.freeProxy?.selected;
  if (!hasManual && !hasFree) {
    $('#screen-firstrun').hidden = false;
  } else {
    showMain();
  }
}

function showMain() {
  $('#screen-main').hidden = false;
  $('#screen-settings').hidden = true;
  $('#screen-firstrun').hidden = true;
  renderMain();
}

function showSettings() {
  $('#screen-main').hidden = true;
  $('#screen-settings').hidden = false;
  $('#screen-firstrun').hidden = true;
  renderSettings();
}

function renderMain() {
  // Status line
  const status = $('#status-line');
  if (!state.enabled) {
    status.textContent = 'Выключено';
    status.classList.add('no-dot');
  } else {
    status.classList.remove('no-dot');
    const t = state.proxy?.lastTest;
    if (t?.ok) {
      status.textContent = `Активно · ${t.ip} · ${t.country || ''} · ${t.latencyMs} мс`;
    } else {
      status.textContent = `Активно · ${state.proxy?.host}:${state.proxy?.port}`;
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

  // Preset grid — grouped by category, a full-width header per group.
  const grid = $('#preset-grid');
  grid.innerHTML = '';
  for (const cat of CATEGORIES) {
    const keys = PRESET_ORDER.filter((k) => PRESET_DEFINITIONS[k].category === cat.key);
    if (!keys.length) continue;

    const header = document.createElement('div');
    header.className = 'cat-header';
    header.textContent = cat.label;
    grid.appendChild(header);

    for (const key of keys) {
      const def = PRESET_DEFINITIONS[key];
      const stored = state.presets[key];
      const isBlocked = (def.domains || []).some((d) => rknResults[d]?.blocked);
      const card = document.createElement('div');
      card.className = 'preset-card'
        + (stored?.enabled ? ' on' : '')
        + (isBlocked ? ' rkn-blocked' : '');
      card.dataset.key = key;

      // Full-colour brand logo with an emoji glyph fallback (CSP-safe: no inline
      // handlers, listener attached via JS).
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

      if (!isBlocked) {
        card.addEventListener('click', () => togglePreset(key));
      }
      grid.appendChild(card);
    }
  }

  // Custom domains list
  const list = $('#custom-list');
  list.innerHTML = '';
  for (const entry of state.customDomains || []) {
    const item = document.createElement('div');
    item.className = 'custom-item';
    const display = entry.mode === 'wildcard'
      ? `*.${entry.value}`
      : entry.mode === 'exact' ? `=${entry.value}` : entry.value;
    item.innerHTML = `
      <div class="dot"></div>
      <div class="value">${escapeHtml(display)}</div>
      <button class="remove" type="button" title="Remove">\u00d7</button>
    `;
    item.querySelector('.remove').addEventListener('click', () => removeCustom(entry));
    list.appendChild(item);
  }

  // AI-free banner
  const aiBanner = $('#ai-free-banner');
  if (aiBanner) {
    const aiOn = AI_PRESET_KEYS.some((k) => state.presets[k]?.enabled);
    aiBanner.hidden = !(aiOn && state.proxySource === 'free' && state.enabled);
  }
}

function bindMain() {
  $('#master-toggle').addEventListener('change', async (e) => {
    state.enabled = e.target.checked;
    await persist();
    renderMain();
  });

  $('#open-settings').addEventListener('click', () => showSettings());

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

    // Success toast + confetti
    showToast(`\u2713 ${entry.value} \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d \u2014 \u043d\u0435 \u0432 \u0440\u0435\u0435\u0441\u0442\u0440\u0435 \u0420\u041a\u041d`);
    launchConfetti();
  });
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

function launchConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti';
  document.body.appendChild(container);

  const colors = ['#10b981', '#06b6d4', '#6366f1', '#f59e0b', '#ec4899'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDelay = (Math.random() * 0.3) + 's';
    p.style.animationDuration = (1 + Math.random() * 0.8) + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    container.appendChild(p);
  }
  setTimeout(() => container.remove(), 2200);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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

  // Source toggle (Manual / Free pool)
  for (const pill of document.querySelectorAll('#source-pills .pill')) {
    pill.addEventListener('click', async () => {
      const source = pill.dataset.source;
      if (state.proxySource === source) return;

      // Disable both pills while switching
      for (const p of document.querySelectorAll('#source-pills .pill')) p.disabled = true;
      $('#rotate-free').disabled = true;
      $('#free-current').textContent = 'Переключение…';

      try {
        const res = await chrome.runtime.sendMessage({ type: 'SWITCH_SOURCE', source });
        if (res?.state) {
          state = res.state;
          renderSettings();
        } else {
          // Background returned an error without state — re-render with current state so UI stays consistent
          renderSettings();
          if (res?.error) {
            $('#free-current').textContent = `Ошибка: ${res.error}`;
          }
        }
      } finally {
        for (const p of document.querySelectorAll('#source-pills .pill')) p.disabled = false;
        $('#rotate-free').disabled = false;
      }
    });
  }

  $('#rotate-free').addEventListener('click', async () => {
    const btn = $('#rotate-free');
    btn.disabled = true;
    $('#free-current').textContent = 'Ищем рабочий прокси…';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ROTATE_FREE' });
      if (res?.state) {
        state = res.state;
        renderSettings();
      } else {
        // Background returned an error without state — re-render with current state so UI stays consistent
        renderSettings();
        if (res?.error) {
          $('#free-current').textContent = `Ошибка: ${res.error}`;
        }
      }
    } finally {
      btn.disabled = false;
    }
  });

  $('#test-proxy').addEventListener('click', () => runTest('TEST_PROXY'));
  $('#test-gemini').addEventListener('click', () => runTest('TEST_GEMINI'));
}

function renderSettings() {
  ensureProxyObject();

  // Source pills
  for (const pill of document.querySelectorAll('#source-pills .pill')) {
    pill.classList.toggle('active', pill.dataset.source === (state.proxySource || 'manual'));
  }

  const isFree = state.proxySource === 'free';
  $('#manual-blocks').hidden = isFree;
  $('#free-block').hidden = !isFree;

  // Manual fields
  $('#cfg-host').value = state.proxy?.host || '';
  $('#cfg-port').value = state.proxy?.port || '';
  $('#cfg-user').value = state.proxy?.user || '';
  $('#cfg-pass').value = state.proxy?.pass || '';
  for (const pill of document.querySelectorAll('#scheme-pills .pill')) {
    pill.classList.toggle('active', pill.dataset.scheme === state.proxy?.scheme);
  }

  // Free-block render
  if (isFree) {
    const sel = state.freeProxy?.selected;
    if (sel) {
      const flag = sel.country ? `${countryFlag(sel.country)} ${sel.country}` : '—';
      $('#free-current').textContent = `${sel.host}:${sel.port}  ${flag}  ${sel.latencyMs} мс`;
    } else if (state.freeProxy?.lastError) {
      $('#free-current').textContent = `Нет рабочего прокси: ${state.freeProxy.lastError}`;
    } else {
      $('#free-current').textContent = 'Прокси не выбран';
    }
    const fetchedAt = state.freeProxy?.poolFetchedAt;
    if (fetchedAt) {
      const ageMin = Math.floor((Date.now() - fetchedAt) / 60_000);
      $('#free-pool-meta').textContent = `Список обновлён ${ageMin} мин назад`;
    } else {
      $('#free-pool-meta').textContent = '';
    }
  }

  renderThemePills();
  $('#test-result').hidden = true;
}

function countryFlag(cc) {
  if (!cc || cc.length !== 2) return '';
  const upper = cc.toUpperCase();
  const A = 0x41, base = 0x1F1E6;
  return String.fromCodePoint(base + upper.charCodeAt(0) - A, base + upper.charCodeAt(1) - A);
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
  result.innerHTML = '\u25f7 \u041e\u043f\u0440\u0435\u0434\u0435\u043b\u044f\u0435\u043c\u2026 HTTP';
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

// Receive live progress from background's pickAndValidate.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'FREE_PROGRESS') return;
  const el = $('#free-current');
  if (!el) return;
  el.textContent = `Проверка ${msg.index}/${msg.total} · ${msg.host}:${msg.port}`;
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
    result.innerHTML = `\u25f7 \u041e\u043f\u0440\u0435\u0434\u0435\u043b\u044f\u0435\u043c\u2026 ${ds.trying?.toUpperCase() || ''}`;
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
  const btnGemini = $('#test-gemini');
  const result = $('#test-result');
  btnProxy.disabled = true;
  btnGemini.disabled = true;
  result.hidden = true;

  try {
    const res = await chrome.runtime.sendMessage({ type });
    result.hidden = false;
    if (res.ok) {
      result.className = 'result-block ok';
      if (type === 'TEST_PROXY') {
        result.innerHTML = `\u2713 \u041f\u0440\u043e\u043a\u0441\u0438 \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d<br>IP: ${res.ip || '?'}<br>\u0421\u0442\u0440\u0430\u043d\u0430: ${res.country || '?'}<br>\u0417\u0430\u0434\u0435\u0440\u0436\u043a\u0430: ${res.latencyMs} \u043c\u0441`;
      } else {
        result.innerHTML = `\u2713 Gemini \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d<br>HTTP ${res.httpStatus}<br>\u0417\u0430\u0434\u0435\u0440\u0436\u043a\u0430: ${res.latencyMs} \u043c\u0441`;
      }
      state = await loadState();
    } else {
      result.className = 'result-block err';
      result.textContent = `\u2717 ${res.error}`;
    }
  } finally {
    btnProxy.disabled = false;
    btnGemini.disabled = false;
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
