// Чистая логика локальной публикации (scripts/publish.mjs): разбор .env и
// загрузка в Chrome Web Store через API v1.1. Сеть передаётся параметром
// fetchFn, чтобы тесты подменяли её без глобальных моков.

const CWS_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CWS_UPLOAD_URL = (id) => `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${id}`;
const CWS_PUBLISH_URL = (id) => `https://www.googleapis.com/chromewebstore/v1.1/items/${id}/publish`;

export const CWS_KEYS = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_EXTENSION_ID'];
export const AMO_KEYS = ['AMO_API_KEY', 'AMO_API_SECRET'];

/** KEY=VALUE по строкам; # — комментарий; кавычки вокруг значения снимаются. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.at(-1) === val[0]) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

/** Имена ключей из `keys`, которых нет (или пустые) в env. */
export function missingKeys(env, keys) {
  return keys.filter((k) => !env[k]);
}

async function readJson(res, step) {
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok) throw new Error(`CWS ${step}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return body || {};
}

/**
 * Обновляет refresh token → access token, загружает zip, публикует.
 * Бросает с понятным текстом на любом шаге; при успехе возвращает ответ publish.
 */
export async function publishToCws(env, zipBytes, fetchFn = fetch) {
  const tokenRes = await fetchFn(CWS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.CWS_CLIENT_ID,
      client_secret: env.CWS_CLIENT_SECRET,
      refresh_token: env.CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const { access_token: accessToken } = await readJson(tokenRes, 'token');
  if (!accessToken) throw new Error('CWS token: в ответе нет access_token (refresh token отозван? перевыпусти: npx chrome-webstore-upload-keys)');
  const auth = { Authorization: `Bearer ${accessToken}`, 'x-goog-api-version': '2' };

  const upload = await readJson(await fetchFn(CWS_UPLOAD_URL(env.CWS_EXTENSION_ID), {
    method: 'PUT', headers: auth, body: zipBytes,
  }), 'upload');
  if (upload.uploadState !== 'SUCCESS') {
    throw new Error(`CWS upload: ${upload.uploadState} ${JSON.stringify(upload.itemError || [])}`);
  }

  const published = await readJson(await fetchFn(CWS_PUBLISH_URL(env.CWS_EXTENSION_ID), {
    method: 'POST', headers: { ...auth, 'Content-Length': '0' },
  }), 'publish');
  const status = published.status || [];
  if (!status.includes('OK') && !status.includes('ITEM_PENDING_REVIEW')) {
    throw new Error(`CWS publish: ${JSON.stringify(status)} ${JSON.stringify(published.statusDetail || [])}`);
  }
  return published;
}
