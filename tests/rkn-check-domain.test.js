// checkDomain: «не удалось загрузить список» ≠ «домен в реестре».
// Регрессия: при недоступном raw.githubusercontent.com попап писал
// «⛔ b24-xxx.bitrix24.ru в списке блокировки», хотя домена в реестре нет.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const DAY = 24 * 60 * 60 * 1000;
let importSeq = 0;

// Модуль держит кэш списка в памяти — каждому тесту нужен свежий экземпляр.
async function freshModule() {
  return import(`../extension/lib/rkn-check.js?case=${++importSeq}`);
}

function stubEnv({ cached = null, fetchImpl }) {
  globalThis.chrome = {
    storage: { local: {
      get: async () => (cached ? { rknListCache: cached } : {}),
      set: async () => {},
    } },
  };
  globalThis.fetch = fetchImpl;
}

const failingFetch = async () => { throw new Error('network down'); };

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.fetch;
});

test('checkDomain: список недоступен и кэша нет → не blocked, а unverified', async () => {
  stubEnv({ fetchImpl: failingFetch });
  const { checkDomain } = await freshModule();

  const result = await checkDomain('b24-uj54qa.bitrix24.ru');

  assert.equal(result.blocked, false);
  assert.equal(result.unverified, true);
});

test('checkDomain: сеть упала, но есть просроченный кэш → решение по кэшу', async () => {
  stubEnv({
    cached: { text: 'blocked.example\nother.test\n', at: Date.now() - 30 * DAY },
    fetchImpl: failingFetch,
  });
  const { checkDomain } = await freshModule();

  const hit = await checkDomain('sub.blocked.example');
  const miss = await checkDomain('b24-uj54qa.bitrix24.ru');

  assert.equal(hit.blocked, true, 'домен из реестра по-прежнему блокируется');
  assert.equal(hit.unverified, undefined);
  assert.equal(miss.blocked, false);
  assert.equal(miss.unverified, undefined, 'данные были — проверка состоялась');
});

test('checkDomain: свежий список без домена → не blocked', async () => {
  stubEnv({
    fetchImpl: async () => ({ ok: true, text: async () => 'bitrix24.capital\n' }),
  });
  const { checkDomain } = await freshModule();

  const result = await checkDomain('b24-uj54qa.bitrix24.ru');

  assert.deepEqual(result, { blocked: false, reason: 'not in RKN registry' });
});
