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
      // Universal router: nothing is routed until the user opts in. (googleAuth is
      // coupled in by pac.js whenever a Google-AI preset is on, regardless of its
      // own enabled flag.)
      gemini:     { enabled: false, domains: ['gemini.google.com'] },
      aiStudio:   { enabled: false, domains: ['aistudio.google.com', 'alkalimakersuite-pa.clients6.google.com'] },
      googleAuth: { enabled: false, domains: ['accounts.google.com', 'ogs.google.com'] },
      notebookLM: { enabled: false, domains: ['notebooklm.google.com'] },
      googleLabs: { enabled: false, domains: ['labs.google', 'labs.google.com'] },
      chatgpt:    { enabled: false, domains: ['chatgpt.com', 'chat.openai.com'] },
      claude:     { enabled: false, domains: ['claude.ai'] },
      perplexity: { enabled: false, domains: ['perplexity.ai', 'www.perplexity.ai'] },
      grok:       { enabled: false, domains: ['grok.com', 'www.grok.com', 'x.ai'] },
      elevenlabs: { enabled: false, domains: ['elevenlabs.io', 'www.elevenlabs.io', 'api.elevenlabs.io'] },
      jetbrainsAi:{ enabled: false, domains: ['jetbrains.com', 'api.jetbrains.ai'] },
      suno:       { enabled: false, domains: ['suno.com', 'studio-api.suno.ai', 'cdn1.suno.ai'] },
      sora:       { enabled: false, domains: ['sora.com', 'sora.chatgpt.com'] },
      poe:        { enabled: false, domains: ['poe.com', 'www.poe.com'] },
      youtube:    { enabled: false, domains: ['youtube.com', 'www.youtube.com', 'youtu.be', 'googlevideo.com'] },
      netflix:    { enabled: false, domains: ['netflix.com', 'www.netflix.com', 'nflxvideo.net', 'nflxext.com', 'nflximg.net', 'nflxso.net'] },
      disneyPlus: { enabled: false, domains: ['disneyplus.com', 'www.disneyplus.com', 'disney-plus.net', 'dssott.com', 'dssedge.com', 'bamgrid.com'] },
      spotify:    { enabled: false, domains: ['spotify.com', 'open.spotify.com', 'api.spotify.com', 'scdn.co', 'spotifycdn.com', 'spotifycdn.net'] },
      max:        { enabled: false, domains: ['max.com', 'play.max.com', 'hbomax.com'] },
      microsoftCopilot: { enabled: false, domains: ['copilot.microsoft.com'] },
      githubCopilot:    { enabled: false, domains: ['github.com', 'api.github.com', 'copilot-proxy.githubusercontent.com', 'api.individual.githubcopilot.com'] },
      primeVideo:       { enabled: false, domains: ['primevideo.com', 'www.primevideo.com', 'atv-ps.amazon.com', 'aiv-cdn.net', 'aiv-delivery.net'] },
      appleTv:          { enabled: false, domains: ['tv.apple.com'] },
      paramountPlus:    { enabled: false, domains: ['paramountplus.com', 'cbsivideo.com'] },
      peacock:          { enabled: false, domains: ['peacocktv.com'] },
      hulu:             { enabled: false, domains: ['hulu.com', 'hulustream.com', 'huluim.com'] },
      crunchyroll:      { enabled: false, domains: ['crunchyroll.com', 'vrv.co'] },
      mubi:             { enabled: false, domains: ['mubi.com'] },
      deezer:           { enabled: false, domains: ['deezer.com', 'dzcdn.net'] },
      tidal:            { enabled: false, domains: ['tidal.com'] },
      figma:            { enabled: false, domains: ['figma.com', 'www.figma.com'] },
      notion:           { enabled: false, domains: ['notion.so', 'www.notion.so', 'notion.com', 'api.notion.com'] },
      wix:              { enabled: false, domains: ['wix.com', 'www.wix.com', 'wixsite.com', 'wixstatic.com'] },
      shopify:          { enabled: false, domains: ['shopify.com', 'www.shopify.com', 'myshopify.com', 'cdn.shopify.com'] },
      namecheap:        { enabled: false, domains: ['namecheap.com', 'www.namecheap.com'] },
      slack:            { enabled: false, domains: ['slack.com', 'app.slack.com', 'slack-edge.com', 'slack-msgs.com'] },
      mailchimp:        { enabled: false, domains: ['mailchimp.com', 'login.mailchimp.com', 'list-manage.com'] },
      upwork:           { enabled: false, domains: ['upwork.com', 'www.upwork.com'] },
      circleci:         { enabled: false, domains: ['circleci.com', 'app.circleci.com'] },
      pornhub:    { enabled: false, domains: ['pornhub.com', 'www.pornhub.com', 'phncdn.com', 'ev-h.phncdn.com'] },
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

  return saved;
}

export async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
