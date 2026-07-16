import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPacScript, isHostRouted, socksAuthUnsupported } from '../extension/lib/pac.js';

function makeState(overrides = {}) {
  return {
    schemaVersion: 1,
    enabled: true,
    proxy: { host: '5.9.12.34', port: 1080, scheme: 'http', user: '', pass: '' },
    presets: {
      gemini:     { enabled: true,  domains: ['gemini.google.com'] },
      aiStudio:   { enabled: false, domains: ['aistudio.google.com'] },
      googleAuth: { enabled: true,  domains: ['accounts.google.com'] },
      notebookLM: { enabled: false, domains: ['notebooklm.google.com'] },
      chatgpt:    { enabled: false, domains: ['chatgpt.com'] },
      claude:     { enabled: false, domains: ['claude.ai'] },
      perplexity: { enabled: false, domains: ['perplexity.ai'] },
    },
    customDomains: [],
    ...overrides,
  };
}

test('buildPacScript: returns null when disabled', () => {
  assert.equal(buildPacScript(makeState({ enabled: false })), null);
});

test('buildPacScript: returns null when no proxy configured', () => {
  assert.equal(buildPacScript(makeState({ proxy: null })), null);
});

test('buildPacScript: HTTP proxy directive for gemini.google.com', () => {
  const pac = buildPacScript(makeState());
  assert.match(pac, /function FindProxyForURL/);
  assert.match(pac, /"gemini\.google\.com"/);
  assert.match(pac, /PROXY 5\.9\.12\.34:1080/);
  assert.match(pac, /return "DIRECT"/);
});

test('buildPacScript: HTTPS scheme', () => {
  const pac = buildPacScript(makeState({
    proxy: { host: 'p.example.com', port: 443, scheme: 'https' },
  }));
  assert.match(pac, /HTTPS p\.example\.com:443/);
});

test('buildPacScript: SOCKS5 scheme has fallback to SOCKS', () => {
  const pac = buildPacScript(makeState({
    proxy: { host: '1.2.3.4', port: 1080, scheme: 'socks5' },
  }));
  assert.match(pac, /SOCKS5 1\.2\.3\.4:1080; SOCKS 1\.2\.3\.4:1080/);
});

test('buildPacScript: SOCKS4 scheme', () => {
  const pac = buildPacScript(makeState({
    proxy: { host: '1.2.3.4', port: 1080, scheme: 'socks4' },
  }));
  assert.match(pac, /SOCKS 1\.2\.3\.4:1080/);
});

test('buildPacScript: never includes ; DIRECT fallback after proxy directive', () => {
  const pac = buildPacScript(makeState());
  assert.equal(pac.includes('; DIRECT'), false);
});

test('buildPacScript: custom suffix domain routed', () => {
  const pac = buildPacScript(makeState({
    customDomains: [{ value: 'huggingface.co', mode: 'suffix' }],
  }));
  assert.match(pac, /"huggingface\.co"/);
  assert.match(pac, /var suffixes = \[.*"huggingface\.co".*\]/);
});

test('buildPacScript: custom wildcard domain in wildcards array', () => {
  const pac = buildPacScript(makeState({
    customDomains: [{ value: 'anthropic.com', mode: 'wildcard' }],
  }));
  assert.match(pac, /var wildcards = \["anthropic\.com"\]/);
});

test('buildPacScript: custom exact domain in exacts array', () => {
  const pac = buildPacScript(makeState({
    customDomains: [{ value: 'example.com', mode: 'exact' }],
  }));
  assert.match(pac, /var exacts = \["example\.com"\]/);
});

test('buildPacScript: googleAuth auto-coupled when AI preset enabled', () => {
  const pac = buildPacScript(makeState({
    presets: {
      gemini:     { enabled: true,  domains: ['gemini.google.com'] },
      aiStudio:   { enabled: false, domains: ['aistudio.google.com'] },
      googleAuth: { enabled: false, domains: ['accounts.google.com'] },
      notebookLM: { enabled: false, domains: [] },
      chatgpt:    { enabled: false, domains: [] },
      claude:     { enabled: false, domains: [] },
      perplexity: { enabled: false, domains: [] },
    },
  }));
  assert.match(pac, /"accounts\.google\.com"/);
});

test('buildPacScript: googleAuth NOT included when no AI preset enabled', () => {
  const pac = buildPacScript(makeState({
    presets: {
      gemini:     { enabled: false, domains: ['gemini.google.com'] },
      aiStudio:   { enabled: false, domains: ['aistudio.google.com'] },
      googleAuth: { enabled: false, domains: ['accounts.google.com'] },
      notebookLM: { enabled: false, domains: [] },
      chatgpt:    { enabled: true,  domains: ['chatgpt.com'] },
      claude:     { enabled: false, domains: [] },
      perplexity: { enabled: false, domains: [] },
    },
    customDomains: [],
  }));
  assert.equal(pac.includes('accounts.google.com'), false);
});

test('buildPacScript: returns null when no domains routed', () => {
  const pac = buildPacScript(makeState({
    presets: {
      gemini:     { enabled: false, domains: [] },
      aiStudio:   { enabled: false, domains: [] },
      googleAuth: { enabled: false, domains: [] },
      notebookLM: { enabled: false, domains: [] },
      chatgpt:    { enabled: false, domains: [] },
      claude:     { enabled: false, domains: [] },
      perplexity: { enabled: false, domains: [] },
    },
    customDomains: [],
  }));
  assert.equal(pac, null);
});

// Regression: googleLabs (couplesGoogleAuth:true) must pull in accounts.google.com.
// Before the single-source-of-truth fix, pac.js hardcoded a 3-key list missing it.
const labsState = {
  enabled: true,
  proxy: { host: '1.2.3.4', port: 8080, scheme: 'http' },
  presets: {
    googleLabs: { enabled: true,  domains: ['labs.google', 'labs.google.com'] },
    googleAuth: { enabled: false, domains: ['accounts.google.com', 'ogs.google.com'] },
    netflix:    { enabled: false, domains: ['netflix.com'] },
  },
  customDomains: [],
};

test('buildPacScript: googleLabs alone couples accounts.google.com (regression)', () => {
  const pac = buildPacScript(labsState);
  assert.match(pac, /"labs\.google"/);
  assert.match(pac, /"accounts\.google\.com"/);
});

test('buildPacScript: a non-Google preset does NOT couple accounts.google.com', () => {
  const pac = buildPacScript({
    enabled: true,
    proxy: { host: '1.2.3.4', port: 8080, scheme: 'http' },
    presets: {
      netflix:    { enabled: true,  domains: ['netflix.com'] },
      googleAuth: { enabled: false, domains: ['accounts.google.com'] },
    },
    customDomains: [],
  });
  assert.match(pac, /"netflix\.com"/);
  assert.doesNotMatch(pac, /accounts\.google\.com/);
});

test('isHostRouted: matches preset domain + subdomain, not others', () => {
  const state = {
    enabled: true,
    proxy: { host: '1.2.3.4', port: 8080, scheme: 'http' },
    presets: { netflix: { enabled: true, domains: ['netflix.com'] } },
    customDomains: [],
  };
  assert.equal(isHostRouted('netflix.com', state), true);
  assert.equal(isHostRouted('www.netflix.com', state), true);
  assert.equal(isHostRouted('example.com', state), false);
});

// SOCKS + credentials can't authenticate in Chrome (no proxy-auth API for SOCKS,
// onAuthRequired never fires for it); Firefox passes them inline. This predicate is
// the single source of truth for the popup warning + background diagnostics.
test('socksAuthUnsupported: SOCKS5/SOCKS4 + user in Chrome → unsupported', () => {
  assert.equal(socksAuthUnsupported('socks5', 'u', false), true);
  assert.equal(socksAuthUnsupported('socks4', 'u', false), true);
});

test('socksAuthUnsupported: SOCKS without a user is fine (no auth needed)', () => {
  assert.equal(socksAuthUnsupported('socks5', '', false), false);
  assert.equal(socksAuthUnsupported('socks5', undefined, false), false);
});

test('socksAuthUnsupported: HTTP/HTTPS + user is fine (onAuthRequired covers it)', () => {
  assert.equal(socksAuthUnsupported('http', 'u', false), false);
  assert.equal(socksAuthUnsupported('https', 'u', false), false);
});

test('socksAuthUnsupported: Firefox authenticates SOCKS inline → supported', () => {
  assert.equal(socksAuthUnsupported('socks5', 'u', true), false);
  assert.equal(socksAuthUnsupported('socks4', 'u', true), false);
});

test('isHostRouted: googleLabs couples accounts.google.com for icon state too', () => {
  assert.equal(isHostRouted('accounts.google.com', labsState), true);
});

test('isHostRouted: false when extension disabled', () => {
  assert.equal(isHostRouted('netflix.com', { ...labsState, enabled: false }), false);
});

// --- Регрессия: dnsDomainIs в Chrome/Firefox — голый суффикс-матч ---
// ("fakegoogle.com" матчится под "google.com"). PAC обязан проверять границу
// метки ('.' + domain) и точное равенство, иначе левые домены-двойники уходят
// через прокси, а isHostRouted (иконка) при этом считает их DIRECT.

// Выполняем сгенерированный PAC с канонической реализацией dnsDomainIs из Chromium.
function evalPac(pac) {
  const dnsDomainIs = (host, domain) =>
    host.length >= domain.length && host.substring(host.length - domain.length) === domain;
  return new Function('dnsDomainIs', `${pac}\nreturn FindProxyForURL;`)(dnsDomainIs);
}

test('PAC: suffix — сам домен и поддомены роутятся, домен-двойник — нет', () => {
  const fn = evalPac(buildPacScript(makeState()));
  assert.match(fn('https://gemini.google.com/', 'gemini.google.com'), /^PROXY /);
  assert.match(fn('https://sub.gemini.google.com/', 'sub.gemini.google.com'), /^PROXY /);
  assert.equal(fn('https://evilgemini.google.com/', 'evilgemini.google.com'), 'DIRECT');
  assert.equal(fn('https://example.com/', 'example.com'), 'DIRECT');
});

test('PAC: wildcard — только поддомены, ни сам домен, ни двойник', () => {
  const fn = evalPac(buildPacScript(makeState({
    customDomains: [{ value: 'anthropic.com', mode: 'wildcard' }],
  })));
  assert.match(fn('https://console.anthropic.com/', 'console.anthropic.com'), /^PROXY /);
  assert.equal(fn('https://anthropic.com/', 'anthropic.com'), 'DIRECT');
  assert.equal(fn('https://evilanthropic.com/', 'evilanthropic.com'), 'DIRECT');
});

test('PAC: exact — только точное совпадение', () => {
  const fn = evalPac(buildPacScript(makeState({
    customDomains: [{ value: 'api.mistral.ai', mode: 'exact' }],
  })));
  assert.match(fn('https://api.mistral.ai/', 'api.mistral.ai'), /^PROXY /);
  assert.equal(fn('https://sub.api.mistral.ai/', 'sub.api.mistral.ai'), 'DIRECT');
});

test('PAC и isHostRouted согласованы на доменах-двойниках', () => {
  const state = makeState();
  const fn = evalPac(buildPacScript(state));
  for (const host of ['gemini.google.com', 'sub.gemini.google.com', 'evilgemini.google.com', 'accounts.google.com']) {
    const pacRouted = fn(`https://${host}/`, host) !== 'DIRECT';
    assert.equal(pacRouted, isHostRouted(host, state), `расхождение PAC/isHostRouted на ${host}`);
  }
});
