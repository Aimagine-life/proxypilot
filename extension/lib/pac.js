// Pure module — no chrome.* APIs allowed. presets.js is pure data, safe to import.
// GOOGLE_AUTH_PRESET_KEYS is the single source of truth (derived from the
// couplesGoogleAuth flag) for which presets pull in the hidden googleAuth
// (accounts.google.com) coupling.

import { GOOGLE_AUTH_PRESET_KEYS } from './presets.js';

function pacDirective(scheme, host, port) {
  switch (scheme) {
    case 'http':   return `PROXY ${host}:${port}`;
    case 'https':  return `HTTPS ${host}:${port}`;
    case 'socks5': return `SOCKS5 ${host}:${port}; SOCKS ${host}:${port}`;
    case 'socks4': return `SOCKS ${host}:${port}`;
    case 'auto':   return `PROXY ${host}:${port}`;
    default:       throw new Error(`Unknown proxy scheme: ${scheme}`);
  }
}

function collectDomains(state) {
  const suffixes = [];
  const wildcards = [];
  const exacts = [];

  const presets = state.presets || {};
  const googleAuthNeeded = GOOGLE_AUTH_PRESET_KEYS.some((k) => presets[k]?.enabled);

  for (const [key, preset] of Object.entries(presets)) {
    const isCoupledGoogleAuth = key === 'googleAuth' && googleAuthNeeded;
    if (!preset.enabled && !isCoupledGoogleAuth) continue;
    for (const d of preset.domains || []) suffixes.push(d);
  }

  for (const entry of state.customDomains || []) {
    if (!entry || !entry.value) continue;
    if (entry.mode === 'wildcard') wildcards.push(entry.value);
    else if (entry.mode === 'exact') exacts.push(entry.value);
    else suffixes.push(entry.value);
  }

  return { suffixes, wildcards, exacts };
}

/**
 * Build a PAC script string from extension state. Returns null if the extension
 * is disabled or no proxy is configured — the caller should clear chrome.proxy
 * settings in that case.
 *
 * The script does NOT include a "; DIRECT" fallback after the proxy directive.
 * If the proxy fails, the request fails — never silently leak through the user's
 * real IP. See spec §13.
 */
export function buildPacScript(state) {
  if (!state || !state.enabled) return null;
  if (!state.proxy || !state.proxy.host || !state.proxy.port) return null;

  const directive = pacDirective(state.proxy.scheme, state.proxy.host, state.proxy.port);
  const { suffixes, wildcards, exacts } = collectDomains(state);

  if (suffixes.length === 0 && wildcards.length === 0 && exacts.length === 0) {
    return null;
  }

  const directiveJson = JSON.stringify(directive);

  return [
    'function FindProxyForURL(url, host) {',
    `  var suffixes = ${JSON.stringify(suffixes)};`,
    '  for (var i = 0; i < suffixes.length; i++) {',
    `    if (dnsDomainIs(host, suffixes[i])) return ${directiveJson};`,
    '  }',
    `  var wildcards = ${JSON.stringify(wildcards)};`,
    '  for (var i = 0; i < wildcards.length; i++) {',
    `    if (host !== wildcards[i] && dnsDomainIs(host, wildcards[i])) return ${directiveJson};`,
    '  }',
    `  var exacts = ${JSON.stringify(exacts)};`,
    '  for (var i = 0; i < exacts.length; i++) {',
    `    if (host === exacts[i]) return ${directiveJson};`,
    '  }',
    '  return "DIRECT";',
    '}',
  ].join('\n');
}

/**
 * Does `host` get routed through the proxy under the current state? Used for
 * toolbar icon state in non-PAC (regular JS) contexts. Shares collectDomains()
 * with buildPacScript so the googleAuth coupling and host matching can never
 * drift from the actual PAC — one source of routing truth.
 */
export function isHostRouted(host, state) {
  if (!buildPacScript(state)) return false; // disabled / no proxy / nothing routed
  const { suffixes, wildcards, exacts } = collectDomains(state);
  for (const s of suffixes) if (host === s || host.endsWith('.' + s)) return true;
  for (const w of wildcards) if (host !== w && host.endsWith('.' + w)) return true;
  for (const e of exacts) if (host === e) return true;
  return false;
}
