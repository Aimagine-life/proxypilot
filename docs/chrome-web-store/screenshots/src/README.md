# Генераторы сторовых композиций

HTML-шаблоны, из которых скриншот-композиции для Chrome Web Store / AMO
рендерятся через Playwright (живой попап в iframe + градиентный фон).

- `store-shot-01.html` → `../01-main.png` (1280×800, 24-bit PNG без альфы)
- `store-marquee.html` → `../promo-marquee-1400x560.jpg` (1400×560 JPEG)

## Как перегенерировать

1. Поднять статику на попап: `cd extension && python -m http.server 8741`.
2. Открыть шаблон в браузере под Playwright, ДО навигации добавив init-script
   с моком `chrome.*` (см. ниже) — он применяется и к iframe.
3. Выставить viewport ровно в размер композиции (1280×800 / 1400×560),
   кликами в iframe включить 2–3 пресета (Gemini, ChatGPT, Claude).
4. Скриншот страницы. PNG прогнать через `PIL: Image.convert('RGB')` —
   CWS требует 24-bit без альфа-канала; marquee снимать сразу в JPEG.

Минимальный мок `chrome.*` для попапа: `storage.local.get/set` (ключ `state`),
`storage.onChanged.addListener`, `runtime.getManifest/sendMessage/onMessage`,
`tabs.query`. State: `enabled: true`, `proxySource: 'manual'`, `proxy` с
`lastTest: { ok: true, country: 'NL', latencyMs: 84 }` — даёт чистый главный
экран без warning-баннеров; `donate.uses: 0` — без donate-баннера.
