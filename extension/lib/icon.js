// chrome.action wrapper. Sets icon, badge, and tooltip per state.
// State machine documented in spec §14. Plan 1 implements 4 states:
// off, routed, direct, error. Plan 2 adds: setupNeeded, detecting, forced.
//
// Icon sets live in icons/light/ and icons/dark/. Caller passes the
// resolved theme ('light' | 'dark') via info.theme so the correct variant
// is picked for the toolbar.
//
// Tooltips are localized via chrome.i18n (import after compat.js in the entry
// point, which background.js does).

import { t } from './i18n.js';

const STATES = {
  off: {
    name: 'off',
    badge: '',
    badgeColor: '#000000',
    tooltipFn: () => t('icon_off_tooltip'),
  },
  routed: {
    name: 'routed',
    badgeColor: '#10b981',
    tooltipFn: ({ host, country, latencyMs }) =>
      t('icon_routed_tooltip', host)
      + (country ? ` (${country})` : '')
      + (latencyMs ? ` · ${latencyMs} ${t('unit_ms')}` : ''),
  },
  direct: {
    name: 'direct',
    badge: '',
    badgeColor: '#000000',
    tooltipFn: ({ host }) => t('icon_direct_tooltip', host),
  },
  error: {
    name: 'error',
    badge: '!',
    badgeColor: '#ef4444',
    tooltipFn: ({ reason }) => t('icon_error_tooltip', reason || t('icon_error_reason_unavailable')),
  },
};

function isNoTabError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('no tab with id') || msg.includes('tab not found');
}

// Tabs can disappear between event delivery and the icon update. Swallow that
// race so it doesn't surface as a noisy "No tab with id" runtime error; rethrow
// anything else. Returns false when the tab was gone, true otherwise.
async function safeActionCall(fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    if (isNoTabError(err)) return false;
    throw err;
  }
}

/**
 * Set the toolbar icon for a single tab. `state` is one of:
 * 'off' | 'routed' | 'direct' | 'error'.
 * `info` is an object with optional fields: host, country, latencyMs, reason, theme.
 * `info.theme` is the resolved theme ('light' | 'dark'), default 'light'.
 */
export async function setIconState(tabId, state, info = {}) {
  const config = STATES[state];
  if (!config) throw new Error(`Unknown icon state: ${state}`);

  const theme = info.theme === 'dark' ? 'dark' : 'light';
  const sizes = [16, 32, 48, 128];
  const path = {};
  for (const size of sizes) path[size] = `icons/${theme}/${config.name}-${size}.png`;
  // If the tab is already gone, skip the rest — the remaining calls would all fail.
  const tabExists = await safeActionCall(() => chrome.action.setIcon({ tabId, path }));
  if (!tabExists) return;

  let badgeText = config.badge;
  if (state === 'routed') {
    badgeText = info.country || '✓';
  }
  await safeActionCall(() => chrome.action.setBadgeText({ tabId, text: badgeText }));
  await safeActionCall(() => chrome.action.setBadgeBackgroundColor({ tabId, color: config.badgeColor }));

  await safeActionCall(() => chrome.action.setTitle({ tabId, title: config.tooltipFn(info) }));
}
