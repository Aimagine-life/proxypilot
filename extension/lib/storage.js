// Wraps chrome.storage.local. Tested in node by mocking globalThis.chrome.

import { PRESET_DEFINITIONS } from './presets.js';

const STORAGE_KEY = 'state';

// Presets enabled on a fresh install. Empty = neutral universal router: nothing
// routes until the user opts in. (googleAuth is coupled in by pac.js whenever a
// Google-AI preset is on, so it never needs to be default-enabled.)
const DEFAULT_ENABLED = new Set([]);

// Derive the default presets map from PRESET_DEFINITIONS — the single source of
// truth — so domains are never duplicated/divergent between the two files.
function buildDefaultPresets() {
  const presets = {};
  for (const [key, def] of Object.entries(PRESET_DEFINITIONS)) {
    presets[key] = { enabled: DEFAULT_ENABLED.has(key), domains: def.domains.slice() };
  }
  return presets;
}

export function getDefaultState() {
  return {
    schemaVersion: 2,
    enabled: false,
    proxy: null,
    proxySource: 'manual',
    manualProxy: null,
    freeProxy: { selected: null, lastError: null, deadHosts: {}, poolFetchedAt: 0 },
    // User's own pool of proxies (proxySource === 'own'). `raw` is the textarea
    // text; `proxies` is the parsed list [{host,port,scheme,user,pass}]. Picked
    // optimistically (no upfront validation) and rotated reactively on error.
    ownPool: { raw: '', proxies: [], selected: null, lastError: null, deadHosts: {} },
    theme: 'auto',
    resolvedTheme: 'light',
    presets: buildDefaultPresets(),
    customDomains: [],
    // Donate nudge bookkeeping (added in 0.12.0). `uses` counts popup opens
    // with an active proxy; the thank-you banner shows at >=3 uses, at most
    // once per 14 days, until dismissed.
    donate: { uses: 0, lastShownAt: 0, dismissed: false },
  };
}

export async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const saved = result[STORAGE_KEY];
  if (!saved) return getDefaultState();

  const defaults = getDefaultState();

  // Migrate v1 → v2.
  if (!saved.schemaVersion || saved.schemaVersion < 2) {
    saved.schemaVersion = 2;
    saved.proxySource = 'manual';
    // Shallow copy — safe as long as `proxy` remains flat (no nested objects).
    saved.manualProxy = saved.proxy ? { ...saved.proxy } : null;
    saved.freeProxy = { ...defaults.freeProxy };
  }

  // Merge: add any new presets that didn't exist when the user first installed.
  // Always backfill DISABLED — a preset reappearing must never silently start
  // routing traffic the user didn't choose.
  for (const [key, def] of Object.entries(defaults.presets)) {
    if (!saved.presets[key]) {
      saved.presets[key] = { ...def, enabled: false };
    }
  }
  // Backfill theme fields for users upgrading from pre-0.4.3.
  if (!saved.theme) saved.theme = defaults.theme;
  if (!saved.resolvedTheme) saved.resolvedTheme = defaults.resolvedTheme;

  // Defensive freeProxy backfill.
  if (!saved.freeProxy) saved.freeProxy = { ...defaults.freeProxy };
  if (!saved.freeProxy.deadHosts) saved.freeProxy.deadHosts = {};

  // ownPool backfill (added in 0.9.0).
  if (!saved.ownPool) saved.ownPool = { ...defaults.ownPool };
  if (!Array.isArray(saved.ownPool.proxies)) saved.ownPool.proxies = [];
  if (!saved.ownPool.deadHosts) saved.ownPool.deadHosts = {};

  // donate backfill (added in 0.12.0).
  if (!saved.donate) saved.donate = { ...defaults.donate };

  return saved;
}

export async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
