#!/usr/bin/env node
// Локальная публикация релиза без GitHub Actions: тесты → сборка → Chrome Web
// Store → Firefox AMO → GitHub Release. Ключи берутся из .env.local (в .gitignore),
// список имён — в .env.example. Запуск: npm run release
//
// Шаг стора без ключей пропускается с предупреждением; ошибка любого стора не
// останавливает остальные, но итоговый код выхода = 1.

import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, missingKeys, publishToCws, CWS_KEYS, AMO_KEYS } from './publish-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });

const envPath = join(root, '.env.local');
const env = { ...(existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}), ...process.env };
const ver = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8')).version;
const chromeZip = join(root, `dist/chrome/proxypilot-${ver}.zip`);
const firefoxZip = join(root, `dist/firefox/proxypilot-${ver}.zip`);
const failures = [];

console.log(`\n=== ProxyPilot ${ver}: тесты и сборка ===`);
run('npm', ['test']);
run('sh', ['scripts/build.sh']);

async function stepCws() {
  const miss = missingKeys(env, CWS_KEYS);
  if (miss.length) return console.warn(`CWS пропущен: нет ${miss.join(', ')} в .env.local`);
  const res = await publishToCws(env, readFileSync(chromeZip));
  console.log(`CWS: отправлено, статус ${JSON.stringify(res.status)}`);
}

function stepAmo() {
  const miss = missingKeys(env, AMO_KEYS);
  if (miss.length) return console.warn(`AMO пропущен: нет ${miss.join(', ')} в .env.local`);
  const src = mkdtempSync(join(tmpdir(), 'proxypilot-ff-'));
  try {
    run('tar', ['-xf', firefoxZip, '-C', src]);
    // Ключи — через env, а не аргументами: не светятся в списке процессов.
    run('npx', ['--yes', 'web-ext@8', 'sign', '--source-dir', src, '--channel', 'listed', '--approval-timeout', '0'], {
      env: { ...process.env, WEB_EXT_API_KEY: env.AMO_API_KEY, WEB_EXT_API_SECRET: env.AMO_API_SECRET },
    });
    console.log('AMO: отправлено на ревью Mozilla');
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
}

function stepGithub() {
  const tag = `v${ver}`;
  try {
    execFileSync('gh', ['release', 'view', tag], { cwd: root, stdio: 'ignore' });
    return console.log(`GitHub: релиз ${tag} уже есть — пропущен`);
  } catch { /* релиза нет — создаём */ }
  const staged = mkdtempSync(join(tmpdir(), 'proxypilot-rel-'));
  try {
    const c = join(staged, `proxypilot-chrome-${ver}.zip`);
    const f = join(staged, `proxypilot-firefox-${ver}.zip`);
    run('cp', [chromeZip, c]);
    run('cp', [firefoxZip, f]);
    run('gh', ['release', 'create', tag, '--title', `ProxyPilot ${tag}`, '--generate-notes', c, f]);
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

for (const [name, step] of [['CWS', stepCws], ['AMO', stepAmo], ['GitHub', stepGithub]]) {
  console.log(`\n=== ${name} ===`);
  try { await step(); } catch (err) { console.error(`${name}: ОШИБКА — ${err.message}`); failures.push(name); }
}

if (failures.length) {
  console.error(`\nНе удалось: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nГотово.');
