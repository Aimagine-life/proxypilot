// Wraps chrome.storage.local. Tested in node by mocking globalThis.chrome.

const STORAGE_KEY = 'state';

export function getDefaultState() {
  return {
    schemaVersion: 2,
    enabled: false,
    proxy: null,
    proxySource: 'manual',
    manualProxy: null,
    freeProxy: { selected: null, lastError: null, deadHosts: {}, poolFetchedAt: 0 },
    theme: 'auto',
    resolvedTheme: 'light',
    presets: {
      gemini:     { enabled: true,  domains: ['gemini.google.com'] },
      aiStudio:   { enabled: true,  domains: ['aistudio.google.com', 'alkalimakersuite-pa.clients6.google.com'] },
      googleAuth: { enabled: true,  domains: ['accounts.google.com', 'ogs.google.com'] },
      notebookLM: { enabled: false, domains: ['notebooklm.google.com'] },
      googleLabs: { enabled: false, domains: ['labs.google', 'labs.google.com'] },
      chatgpt:    { enabled: false, domains: ['chatgpt.com', 'chat.openai.com'] },
      claude:     { enabled: false, domains: ['claude.ai'] },
      perplexity: { enabled: false, domains: ['perplexity.ai', 'www.perplexity.ai'] },
      grok:       { enabled: false, domains: ['grok.com', 'www.grok.com', 'x.ai'] },
      elevenlabs: { enabled: false, domains: ['elevenlabs.io', 'www.elevenlabs.io', 'api.elevenlabs.io'] },
      youtube:    { enabled: false, domains: ['youtube.com', 'www.youtube.com', 'youtu.be', 'googlevideo.com'] },
    },
    customDomains: [],
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
  for (const [key, def] of Object.entries(defaults.presets)) {
    if (!saved.presets[key]) {
      saved.presets[key] = def;
    }
  }
  // Backfill theme fields for users upgrading from pre-0.4.3.
  if (!saved.theme) saved.theme = defaults.theme;
  if (!saved.resolvedTheme) saved.resolvedTheme = defaults.resolvedTheme;

  // Defensive freeProxy backfill.
  if (!saved.freeProxy) saved.freeProxy = { ...defaults.freeProxy };
  if (!saved.freeProxy.deadHosts) saved.freeProxy.deadHosts = {};

  return saved;
}

export async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
