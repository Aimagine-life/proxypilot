// Generates extension/popup/_shot.html — a screenshot harness that renders the
// REAL popup (popup.js + popup.css) inside a promo banner, with chrome.i18n /
// chrome.storage mocked so the popup believes it's running in the extension.
//
// Query params drive it: ?lang=en|ru&screen=main|free|settings
// Playwright loads it at 1280x800 and screenshots. Delete _shot.html afterwards.
//
// Run: node tools/store-shots/build-harness.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, '..', '..', 'extension');

const popupHtml = readFileSync(join(ext, 'popup', 'popup.html'), 'utf8');
const en = readFileSync(join(ext, '_locales', 'en', 'messages.json'), 'utf8');
const ru = readFileSync(join(ext, '_locales', 'ru', 'messages.json'), 'utf8');

// Extract the <div id="app">…</div> block (the popup markup) verbatim.
const appMatch = popupHtml.match(/<div id="app">[\s\S]*?<\/div>\s*<canvas/);
const appMarkup = appMatch
  ? appMatch[0].replace(/\s*<canvas$/, '')
  : (() => { throw new Error('could not extract #app markup'); })();

const BANNERS = {
  main: {
    grad: 'linear-gradient(135deg, #6d5cf6 0%, #5b6cf0 55%, #4f7cf2 100%)',
    title: { en: 'Open AI services without a VPN', ru: 'Открывай AI-сервисы без VPN' },
    sub: {
      en: 'Route only the sites you need through a proxy — everything else goes direct.',
      ru: 'Маршрутизируй только нужные сайты через прокси — остальное идёт напрямую.',
    },
  },
  free: {
    grad: 'linear-gradient(135deg, #b15cf0 0%, #7d5cf2 60%, #5b6cf0 100%)',
    title: { en: 'A free proxy in seconds', ru: 'Бесплатный прокси за пару секунд' },
    sub: {
      en: "Picks a working one from trusted lists and tells you when it's found.",
      ru: 'Подбирает рабочий из проверенных списков и сообщает, когда нашёл.',
    },
  },
  settings: {
    grad: 'linear-gradient(135deg, #2f7cf6 0%, #3aa0e8 55%, #34c0d6 100%)',
    title: { en: "Always clear what's running", ru: 'Всегда ясно, что работает' },
    sub: {
      en: 'Your proxy, your pool, or free — the active source is visible at a glance.',
      ru: 'Свой прокси, свой пул или бесплатный — активный источник виден сразу.',
    },
  },
  // Wide marquee tile (1400x560) — shows the main screen.
  marquee: {
    grad: 'linear-gradient(120deg, #6d5cf6 0%, #6160ee 45%, #36c2ad 100%)',
    title: { en: 'Reach blocked AI, video & more', ru: 'Открывай заблокированные AI, видео и не только' },
    sub: {
      en: 'Per-domain routing through your own proxy or a free pool. No account, no tracking.',
      ru: 'Маршрутизация по доменам через свой прокси или бесплатный пул. Без аккаунта и слежки.',
    },
  },
};

const logoSvg = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M14 8H27a11 11 0 0 1 0 22h-7v10h-6ZM20 13.5v11h7a5.5 5.5 0 0 0 0-11h-7Z" fill="#fff"/><circle cx="35.5" cy="12.5" r="3.4" fill="#5eead4"/></svg>';

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="./popup.css" />
<style>
  html, body { margin: 0; padding: 0; }
  body.banner {
    width: 1280px; height: 800px; overflow: hidden;
    display: flex; align-items: center; gap: 40px;
    font-family: -apple-system, "Segoe UI", Roboto, Inter, sans-serif;
    padding: 0 80px; box-sizing: border-box;
  }
  .banner-left { flex: 1 1 0; color: #fff; max-width: 560px; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 56px; }
  .brand .mk { width: 40px; height: 40px; background: rgba(255,255,255,.16);
    border-radius: 11px; display: grid; place-items: center; }
  .brand .mk svg { width: 26px; height: 26px; }
  .brand .nm { font-size: 22px; font-weight: 700; letter-spacing: -.01em; }
  .banner-left h1 { font-size: 52px; line-height: 1.07; font-weight: 800;
    letter-spacing: -.02em; margin: 0 0 22px; }
  .banner-left p { font-size: 21px; line-height: 1.45; margin: 0;
    color: rgba(255,255,255,.86); max-width: 480px; }
  .banner-right { flex: 0 0 auto; display: grid; place-items: center; width: 420px; }
  /* The popup root, scaled up into a floating card. popup.css styles #app. */
  .device { width: 360px; border-radius: 22px; overflow: hidden;
    box-shadow: 0 40px 90px -20px rgba(20,16,60,.55), 0 8px 24px rgba(20,16,60,.25);
    transform: scale(1.06); background: var(--bg, #fff); }
  #app { width: 360px; }
  .screen { position: static !important; }
  #confetti { display: none !important; }
  /* Hide scrollbars inside the popup card for a clean promo shot. */
  .device * { scrollbar-width: none; }
  .device *::-webkit-scrollbar { width: 0; height: 0; display: none; }
</style>
</head>
<body class="banner" data-theme="light">
  <div class="banner-left">
    <div class="brand"><span class="mk">${logoSvg}</span><span class="nm">ProxyPilot</span></div>
    <h1 id="bn-title"></h1>
    <p id="bn-sub"></p>
  </div>
  <div class="banner-right">
    <div class="device">
      ${appMarkup}
    </div>
  </div>

  <script>
    const MESSAGES = { en: ${en}, ru: ${ru} };
    const BANNERS = ${JSON.stringify(BANNERS)};
    const q = new URLSearchParams(location.search);
    const LANG = q.get('lang') === 'ru' ? 'ru' : 'en';
    const SCREEN = q.get('screen') || 'main';

    // Promo banner text + gradient.
    document.body.style.background = BANNERS[SCREEN].grad;
    document.getElementById('bn-title').textContent = BANNERS[SCREEN].title[LANG];
    document.getElementById('bn-sub').textContent = BANNERS[SCREEN].sub[LANG];

    // Canvas size (default 1280x800; marquee passes ?w=1400&h=560).
    const W = Number(q.get('w')) || 1280;
    const H = Number(q.get('h')) || 800;
    document.body.style.width = W + 'px';
    document.body.style.height = H + 'px';
    if (H < 640) {
      // Short marquee: scale the popup card to fit and anchor it to the top.
      const card = document.querySelector('.device');
      card.style.transformOrigin = 'top center';
      card.style.transform = 'scale(' + ((H - 64) / 600).toFixed(3) + ')';
      document.body.style.alignItems = 'flex-start';
      document.body.style.paddingTop = '34px';
      document.querySelector('.banner-left').style.marginTop = '-10px';
    }

    // Demo extension state — a believable, filled-in snapshot.
    const proxy = { host: '185.220.101.5', port: 1080, scheme: 'socks5', user: '', pass: '',
      lastTest: { ok: true, country: 'NL', latencyMs: 142, ip: '185.220.101.5', at: 1 } };
    const enabledKeys = ['gemini', 'chatgpt', 'claude', 'perplexity', 'youtube', 'netflix', 'spotify', 'figma'];
    const presets = {};
    for (const k of enabledKeys) presets[k] = { enabled: true };
    const base = {
      schemaVersion: 2, enabled: true, proxy, proxySource: 'manual',
      manualProxy: { ...proxy }, theme: 'light', resolvedTheme: 'light',
      freeProxy: { selected: null, lastError: null, deadHosts: {}, poolFetchedAt: Date.now() - 120000 },
      ownPool: { raw: '', proxies: [], selected: null, lastError: null, deadHosts: {} },
      presets, customDomains: [{ value: 'huggingface.co', mode: 'suffix' }],
      donate: { uses: 0, lastShownAt: 0, dismissed: true }, rknResults: {},
    };
    if (SCREEN === 'free') {
      base.proxySource = 'free';
      base.freeProxy.selected = { host: '146.59.92.18', port: 8080, scheme: 'https',
        country: 'DE', latencyMs: 380, validatedAt: Date.now() };
    }
    const DEMO_STATE = base;

    function fmt(msg, subs) {
      if (subs == null) return msg;
      const arr = Array.isArray(subs) ? subs : [subs];
      return msg.replace(/\\$(\\d)/g, (_, n) => (arr[n - 1] != null ? String(arr[n - 1]) : ''));
    }
    window.chrome = {
      i18n: {
        getUILanguage: () => LANG,
        getMessage: (key, subs) => {
          const e = MESSAGES[LANG][key];
          return e ? fmt(e.message, subs) : '';
        },
      },
      storage: {
        local: { get: () => Promise.resolve({ state: DEMO_STATE }), set: () => Promise.resolve() },
        onChanged: { addListener: () => {} },
      },
      runtime: {
        getManifest: () => ({ version: '0.13.1' }),
        sendMessage: () => Promise.resolve({}),
        onMessage: { addListener: () => {} },
      },
    };
    // Flag for the screenshot driver: which screen to reveal after init.
    window.__SHOT_SCREEN = SCREEN;
  </script>
  <script type="module" src="./popup.js"></script>
</body>
</html>
`;

writeFileSync(join(ext, 'popup', '_shot.html'), html);
console.log('wrote extension/popup/_shot.html');

// --- Small promo tile (440x280): logo + name + tagline, no popup. ---
const PROMO_TAG = {
  en: 'AI & sites without a VPN — through your own or a free proxy',
  ru: 'AI и сайты без VPN — через свой или бесплатный прокси',
};
const promoHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><style>
  html, body { margin: 0; padding: 0; }
  body { width: 440px; height: 280px; overflow: hidden; box-sizing: border-box;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: linear-gradient(120deg, #7b5cff 0%, #6a5cf0 42%, #36c2ad 100%);
    font-family: -apple-system, "Segoe UI", Roboto, Inter, sans-serif; color: #fff;
    text-align: center; padding: 0 28px; }
  .logo { width: 60px; height: 60px; margin-bottom: 16px; }
  .logo svg { width: 100%; height: 100%; filter: drop-shadow(0 6px 16px rgba(20,16,60,.35)); }
  .name { font-size: 30px; font-weight: 800; letter-spacing: -.01em; margin-bottom: 14px; }
  .tag { font-size: 15px; line-height: 1.4; color: rgba(255,255,255,.94); max-width: 384px; }
</style></head><body>
  <div class="logo">${logoSvg}</div>
  <div class="name">ProxyPilot</div>
  <div class="tag" id="tag"></div>
  <script>
    const TAG = ${JSON.stringify(PROMO_TAG)};
    const L = new URLSearchParams(location.search).get('lang') === 'ru' ? 'ru' : 'en';
    document.getElementById('tag').textContent = TAG[L];
  </script>
</body></html>
`;
writeFileSync(join(ext, 'popup', '_promo.html'), promoHtml);
console.log('wrote extension/popup/_promo.html');
