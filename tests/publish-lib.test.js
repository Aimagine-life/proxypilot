import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, missingKeys, publishToCws, CWS_KEYS } from '../scripts/publish-lib.mjs';

const ENV = {
  CWS_CLIENT_ID: 'cid', CWS_CLIENT_SECRET: 'csec', CWS_REFRESH_TOKEN: 'rt', CWS_EXTENSION_ID: 'ext123',
};

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return responses.shift(); };
  return { fn, calls };
}

test('parseEnv: ключи, комментарии, кавычки, CRLF', () => {
  const env = parseEnv('# comment\r\nA=1\r\nB="two words"\n\nC=\'x=y\'\nbroken\n');
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'x=y' });
});

test('missingKeys: пустое значение считается отсутствующим', () => {
  assert.deepEqual(missingKeys({ ...ENV, CWS_REFRESH_TOKEN: '' }, CWS_KEYS), ['CWS_REFRESH_TOKEN']);
});

test('publishToCws: token → upload → publish в нужные URL с Bearer', async () => {
  const { fn, calls } = fakeFetch([
    jsonRes({ access_token: 'AT' }),
    jsonRes({ uploadState: 'SUCCESS' }),
    jsonRes({ status: ['OK'] }),
  ]);
  const res = await publishToCws(ENV, new Uint8Array([1]), fn);
  assert.deepEqual(res.status, ['OK']);
  assert.match(calls[1].url, /\/upload\/chromewebstore\/v1\.1\/items\/ext123$/);
  assert.match(calls[2].url, /\/items\/ext123\/publish$/);
  assert.equal(calls[2].init.headers.Authorization, 'Bearer AT');
});

test('publishToCws: отозванный refresh token → понятная ошибка', async () => {
  const { fn } = fakeFetch([jsonRes({ error: 'invalid_grant' }, 400)]);
  await assert.rejects(() => publishToCws(ENV, new Uint8Array([1]), fn), /CWS token: HTTP 400/);
});

test('publishToCws: upload FAILURE не доходит до publish', async () => {
  const { fn, calls } = fakeFetch([
    jsonRes({ access_token: 'AT' }),
    jsonRes({ uploadState: 'FAILURE', itemError: [{ error_detail: 'version must be greater' }] }),
  ]);
  await assert.rejects(() => publishToCws(ENV, new Uint8Array([1]), fn), /version must be greater/);
  assert.equal(calls.length, 2);
});

test('publishToCws: ITEM_PENDING_REVIEW — успех', async () => {
  const { fn } = fakeFetch([
    jsonRes({ access_token: 'AT' }),
    jsonRes({ uploadState: 'SUCCESS' }),
    jsonRes({ status: ['ITEM_PENDING_REVIEW'] }),
  ]);
  const res = await publishToCws(ENV, new Uint8Array([1]), fn);
  assert.deepEqual(res.status, ['ITEM_PENDING_REVIEW']);
});
