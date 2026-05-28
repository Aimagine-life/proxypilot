// chrome.action wrapper. Sets icon, badge, and tooltip per state.
// State machine documented in spec §14. Plan 1 implements 4 states:
// off, routed, direct, error. Plan 2 adds: setupNeeded, detecting, forced.
//
// Icon sets live in icons/light/ and icons/dark/. Caller passes the
// resolved theme ('light' | 'dark') via info.theme so the correct variant
// is picked for the toolbar.

const STATES = {
  off: {
    name: 'off',
    badge: '',
    badgeColor: '#000000',
    tooltipFn: () => 'ProxyPilot — выключено',
  },
  routed: {
    name: 'routed',
    badgeColor: '#10b981',
    tooltipFn: ({ host, country, latencyMs }) =>
      `ProxyPilot — ${host} через прокси${country ? ' (' + country + ')' : ''}${latencyMs ? ' · ' + latencyMs + ' мс' : ''}`,
  },
  direct: {
    name: 'direct',
    badge: '',
    badgeColor: '#000000',
    tooltipFn: ({ host }) => `ProxyPilot — ${host} напрямую (не в списке маршрутизации)`,
  },
  error: {
    name: 'error',
    badge: '!',
    badgeColor: '#ef4444',
    tooltipFn: ({ reason }) => `ProxyPilot — ошибка прокси: ${reason || 'недоступен'}`,
  },
};

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
  await chrome.action.setIcon({ tabId, path });

  let badgeText = config.badge;
  if (state === 'routed') {
    badgeText = info.country || '✓';
  }
  await chrome.action.setBadgeText({ tabId, text: badgeText });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: config.badgeColor });

  await chrome.action.setTitle({ tabId, title: config.tooltipFn(info) });
}
