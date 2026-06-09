// Pure data module. Single source of truth for the preset list.
// When adding a preset: also (1) add it to storage.js getDefaultState().presets,
// (2) give it a `category` from CATEGORIES, (3) drop a logo file in
// extension/icons/brands/<logo>, and (4) update the README service tables.
//
// `category` — grouping key (see CATEGORIES); the popup renders a header per group.
// `logo`     — filename in extension/icons/brands/, rendered full-colour in the grid.
// `icon`     — emoji/glyph fallback used only if the logo image fails to load.
// `isAi`     — RESERVED for Google AI properties: when any isAi preset is enabled,
//              pac.js auto-routes Google login (accounts.google.com). Non-Google
//              services MUST be isAi:false even if they are AI tools.
//
// All services here geo-block Russia FROM THEIR OWN SIDE and are NOT in the RKN
// registry (verified against zapret-info/z-i). Some are account/payment-gated
// ("type B") — a proxy alone may not be enough; see the README notes.

export const CATEGORIES = [
  { key: 'aiChat',  label: 'AI-ассистенты' },
  { key: 'aiTools', label: 'AI: код · медиа · голос' },
  { key: 'video',   label: 'Видео' },
  { key: 'music',   label: 'Музыка' },
  { key: 'design',  label: 'Дизайн и продуктивность' },
  { key: 'web',     label: 'Сайты · хостинг · магазины' },
  { key: 'work',    label: 'Работа · команды · dev' },
  { key: 'adult',   label: '18+' },
];

export const PRESET_DEFINITIONS = {
  // ─────────────────────────── AI-ассистенты ───────────────────────────
  gemini: {
    label: 'Gemini', icon: '✦', logo: 'gemini.svg', category: 'aiChat',
    domains: ['gemini.google.com'],
    isAi: true,
  },
  aiStudio: {
    label: 'AI Studio', icon: '⚡', logo: 'aiStudio.png', category: 'aiChat',
    domains: ['aistudio.google.com', 'alkalimakersuite-pa.clients6.google.com'],
    isAi: true,
  },
  notebookLM: {
    label: 'NotebookLM', icon: '📓', logo: 'notebookLM.png', category: 'aiChat',
    domains: ['notebooklm.google.com'],
    isAi: true,
  },
  googleLabs: {
    label: 'Google Labs', icon: '🧪', logo: 'googleLabs.png', category: 'aiChat',
    domains: ['labs.google', 'labs.google.com'],
    isAi: true,
  },
  chatgpt: {
    label: 'ChatGPT', icon: '◎', logo: 'chatgpt.svg', category: 'aiChat',
    domains: ['chatgpt.com', 'chat.openai.com'],
    isAi: false,
  },
  claude: {
    label: 'Claude', icon: '✱', logo: 'claude.svg', category: 'aiChat',
    domains: ['claude.ai'],
    isAi: false,
  },
  perplexity: {
    label: 'Perplexity', icon: '⬢', logo: 'perplexity.svg', category: 'aiChat',
    domains: ['perplexity.ai', 'www.perplexity.ai'],
    isAi: false,
  },
  grok: {
    label: 'Grok', icon: '𝕏', logo: 'grok.png', category: 'aiChat',
    domains: ['grok.com', 'www.grok.com', 'x.ai'],
    isAi: false,
  },
  microsoftCopilot: {
    label: 'MS Copilot', icon: '◆', logo: 'microsoftCopilot.svg', category: 'aiChat',
    // Type B: санкции (Country Group E:1) + блок по региону аккаунта; режет
    // датацентр-VPN. Прокси одного может не хватить.
    domains: ['copilot.microsoft.com'],
    isAi: false,
  },
  poe: {
    label: 'Poe', icon: '❖', logo: 'poe.svg', category: 'aiChat',
    domains: ['poe.com', 'www.poe.com'],
    isAi: false,
  },

  // ──────────────────── AI: код · медиа · голос ────────────────────
  jetbrainsAi: {
    label: 'JetBrains AI', icon: '⌨', logo: 'jetbrainsAi.svg', category: 'aiTools',
    domains: ['jetbrains.com', 'api.jetbrains.ai'],
    isAi: false,
  },
  githubCopilot: {
    label: 'GitHub Copilot', icon: '🐙', logo: 'githubCopilot.svg', category: 'aiTools',
    // Type B: санкции EAR + блок по региону аккаунта + не-РФ карта.
    domains: ['github.com', 'api.github.com', 'copilot-proxy.githubusercontent.com', 'api.individual.githubcopilot.com'],
    isAi: false,
  },
  suno: {
    label: 'Suno', icon: '🎵', logo: 'suno.png', category: 'aiTools',
    domains: ['suno.com', 'studio-api.suno.ai', 'cdn1.suno.ai'],
    isAi: false,
  },
  sora: {
    label: 'Sora', icon: '🎬', logo: 'sora.svg', category: 'aiTools',
    domains: ['sora.com', 'sora.chatgpt.com'],
    isAi: false,
  },
  elevenlabs: {
    label: 'ElevenLabs', icon: '🔊', logo: 'elevenlabs.svg', category: 'aiTools',
    domains: ['elevenlabs.io', 'www.elevenlabs.io', 'api.elevenlabs.io'],
    isAi: false,
  },

  // ─────────────────────────── Видео ───────────────────────────
  youtube: {
    label: 'YouTube', icon: '▶', logo: 'youtube.svg', category: 'video',
    domains: ['youtube.com', 'www.youtube.com', 'youtu.be', 'googlevideo.com'],
    isAi: false,
  },
  netflix: {
    label: 'Netflix', icon: '🅽', logo: 'netflix.svg', category: 'video',
    domains: ['netflix.com', 'www.netflix.com', 'nflxvideo.net', 'nflxext.com', 'nflximg.net', 'nflxso.net'],
    isAi: false,
  },
  disneyPlus: {
    label: 'Disney+', icon: '🏰', logo: 'disneyPlus.svg', category: 'video',
    domains: ['disneyplus.com', 'www.disneyplus.com', 'disney-plus.net', 'dssott.com', 'dssedge.com', 'bamgrid.com'],
    isAi: false,
  },
  max: {
    label: 'Max (HBO)', icon: '🎬', logo: 'max.png', category: 'video',
    domains: ['max.com', 'play.max.com', 'hbomax.com'],
    isAi: false,
  },
  primeVideo: {
    label: 'Prime Video', icon: '📺', logo: 'primeVideo.svg', category: 'video',
    domains: ['primevideo.com', 'www.primevideo.com', 'atv-ps.amazon.com', 'aiv-cdn.net', 'aiv-delivery.net'],
    isAi: false,
  },
  appleTv: {
    label: 'Apple TV+', icon: '', logo: 'appleTv.svg', category: 'video',
    domains: ['tv.apple.com'],
    isAi: false,
  },
  paramountPlus: {
    label: 'Paramount+', icon: '⛰', logo: 'paramountPlus.svg', category: 'video',
    domains: ['paramountplus.com', 'cbsivideo.com'],
    isAi: false,
  },
  peacock: {
    label: 'Peacock', icon: '🦚', logo: 'peacock.png', category: 'video',
    domains: ['peacocktv.com'],
    isAi: false,
  },
  hulu: {
    label: 'Hulu', icon: '🟢', logo: 'hulu.svg', category: 'video',
    domains: ['hulu.com', 'hulustream.com', 'huluim.com'],
    isAi: false,
  },
  crunchyroll: {
    label: 'Crunchyroll', icon: '🍥', logo: 'crunchyroll.svg', category: 'video',
    domains: ['crunchyroll.com', 'vrv.co'],
    isAi: false,
  },
  mubi: {
    label: 'MUBI', icon: '🎞', logo: 'mubi.svg', category: 'video',
    domains: ['mubi.com'],
    isAi: false,
  },

  // ─────────────────────────── Музыка ───────────────────────────
  spotify: {
    label: 'Spotify', icon: '🎧', logo: 'spotify.svg', category: 'music',
    domains: ['spotify.com', 'open.spotify.com', 'api.spotify.com', 'scdn.co', 'spotifycdn.com', 'spotifycdn.net'],
    isAi: false,
  },
  deezer: {
    label: 'Deezer', icon: '🎵', logo: 'deezer.svg', category: 'music',
    domains: ['deezer.com', 'dzcdn.net'],
    isAi: false,
  },
  tidal: {
    label: 'Tidal', icon: '🌊', logo: 'tidal.svg', category: 'music',
    domains: ['tidal.com'],
    isAi: false,
  },

  // ──────────────────── Дизайн и продуктивность ────────────────────
  figma: {
    label: 'Figma', icon: '✎', logo: 'figma.svg', category: 'design',
    // Type B: блок только на оплату/апгрейд (free обычно работает), нужна не-РФ карта.
    domains: ['figma.com', 'www.figma.com'],
    isAi: false,
  },
  notion: {
    label: 'Notion', icon: '📝', logo: 'notion.svg', category: 'design',
    // Type B: ушёл из РФ; VPN явно не помогает аккаунтам с РФ-биллингом.
    domains: ['notion.so', 'www.notion.so', 'notion.com', 'api.notion.com'],
    isAi: false,
  },

  // ──────────────── Сайты · хостинг · магазины ────────────────
  wix: {
    label: 'Wix', icon: 'ⓦ', logo: 'wix.svg', category: 'web',
    // Type B: с 12.09.2024 блок по резидентству аккаунта.
    domains: ['wix.com', 'www.wix.com', 'wixsite.com', 'wixstatic.com'],
    isAi: false,
  },
  shopify: {
    label: 'Shopify', icon: '🛍', logo: 'shopify.svg', category: 'web',
    // Type B: checkout/Payments отрублены для РФ-мерчантов.
    domains: ['shopify.com', 'www.shopify.com', 'myshopify.com', 'cdn.shopify.com'],
    isAi: false,
  },
  namecheap: {
    label: 'Namecheap', icon: '🌐', logo: 'namecheap.svg', category: 'web',
    // Type B: по стране регистрации аккаунта.
    domains: ['namecheap.com', 'www.namecheap.com'],
    isAi: false,
  },

  // ──────────────── Работа · команды · dev ────────────────
  slack: {
    label: 'Slack', icon: '#', logo: 'slack.svg', category: 'work',
    // Type B: заблокил по санкциям на уровне аккаунта.
    domains: ['slack.com', 'app.slack.com', 'slack-edge.com', 'slack-msgs.com'],
    isAi: false,
  },
  mailchimp: {
    label: 'Mailchimp', icon: '✉', logo: 'mailchimp.svg', category: 'work',
    // Type B: аккаунты "based in Russia" подвешены.
    domains: ['mailchimp.com', 'login.mailchimp.com', 'list-manage.com'],
    isAi: false,
  },
  upwork: {
    label: 'Upwork', icon: '🟩', logo: 'upwork.svg', category: 'work',
    // Type B: suspend по резидентству + не-РФ платёжка.
    domains: ['upwork.com', 'www.upwork.com'],
    isAi: false,
  },
  circleci: {
    label: 'CircleCI', icon: '◉', logo: 'circleci.svg', category: 'work',
    // Type B: флаг по user-ID; VPN может выдать перманентный бан.
    domains: ['circleci.com', 'app.circleci.com'],
    isAi: false,
  },

  // ─────────────────────────── 18+ ───────────────────────────
  pornhub: {
    label: 'Pornhub', icon: '🔞', logo: 'pornhub.png', category: 'adult',
    // Из РФ Pornhub требует вход через VK (age-gate сервиса); не-РФ IP его минует.
    // Апекс не в реестре РКН (24h RKN-проверка отключит роутинг, если изменится).
    domains: ['pornhub.com', 'www.pornhub.com', 'phncdn.com', 'ev-h.phncdn.com'],
    isAi: false,
  },

  // Hidden preset — auto-routes Google login domains when ANY isAi preset is enabled.
  // Not exposed in UI; managed by pac.js.
  googleAuth: {
    label: 'Google login (auto)', icon: '🔐', category: 'aiChat',
    domains: ['accounts.google.com', 'ogs.google.com'],
    isAi: false,
    hidden: true,
  },
};

// Display / iteration order, grouped by category (matches CATEGORIES order).
export const PRESET_ORDER = [
  // aiChat
  'gemini', 'aiStudio', 'notebookLM', 'googleLabs', 'chatgpt', 'claude',
  'perplexity', 'grok', 'microsoftCopilot', 'poe',
  // aiTools
  'jetbrainsAi', 'githubCopilot', 'suno', 'sora', 'elevenlabs',
  // video
  'youtube', 'netflix', 'disneyPlus', 'max', 'primeVideo', 'appleTv',
  'paramountPlus', 'peacock', 'hulu', 'crunchyroll', 'mubi',
  // music
  'spotify', 'deezer', 'tidal',
  // design
  'figma', 'notion',
  // web
  'wix', 'shopify', 'namecheap',
  // work
  'slack', 'mailchimp', 'upwork', 'circleci',
  // adult
  'pornhub',
];

export const AI_PRESET_KEYS = Object.entries(PRESET_DEFINITIONS)
  .filter(([_, p]) => p.isAi)
  .map(([k, _]) => k);
