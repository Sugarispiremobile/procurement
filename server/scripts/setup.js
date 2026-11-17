// Настройка одной командой: npm run setup
// 1) создаёт .env (со случайным JWT_SECRET), 2) поднимает PostgreSQL через Docker, если он нужен и доступен,
// 3) создаёт базу данных, 4) применяет схему и загружает начальные данные.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(serverDir, '..');
const envPath = path.join(serverDir, '.env');
const log = (m) => console.log(`• ${m}`);

// ---------- 1. .env ----------
let generatedAdminPassword = null;
if (!fs.existsSync(envPath)) {
  generatedAdminPassword = crypto.randomBytes(9).toString('base64url'); // 12 символов, у каждого запуска свой
  let text = fs.readFileSync(path.join(serverDir, '.env.example'), 'utf8');
  text = text
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${crypto.randomBytes(48).toString('hex')}`)
    .replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${generatedAdminPassword}`);
  fs.writeFileSync(envPath, text);
  log('Создан server/.env со случайными JWT_SECRET и паролем администратора');
} else {
  log('server/.env уже есть');
}
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const url = new URL(env.DATABASE_URL);
const dbName = decodeURIComponent(url.pathname.slice(1));

// ---------- 2. подключение к серверу PostgreSQL ----------
const tryConnect = async (connectionString) => {
  const c = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
  await c.connect();
  return c;
};
const maintenanceUrl = (() => { const u = new URL(env.DATABASE_URL); u.pathname = '/postgres'; return u.toString(); })();

async function connectServer() {
  try { return await tryConnect(maintenanceUrl); } catch (e) { return e; }
}

let probe = await connectServer();
const isDown = (e) => ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(e?.code) || e?.name === 'AggregateError';

if (probe instanceof Error && isDown(probe) && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
  const hasDocker = spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0;
  if (hasDocker && fs.existsSync(path.join(rootDir, 'docker-compose.yml'))) {
    log('PostgreSQL не отвечает — запускаю его через Docker (docker compose up -d)…');
    const r = spawnSync('docker', ['compose', 'up', '-d'], { cwd: rootDir, stdio: 'inherit' });
    if (r.status === 0) {
      for (let i = 0; i < 30 && probe instanceof Error; i++) {
        await new Promise((res) => setTimeout(res, 1000));
        probe = await connectServer();
      }
    }
  }
}

if (probe instanceof Error) {
  console.error(`\n✗ Не удалось подключиться к PostgreSQL (${url.hostname}:${url.port || 5432}): ${probe.message || probe.code}\n`);
  console.error('Что сделать:');
  console.error('  1) Установите Docker Desktop и запустите «docker compose up -d» в корне проекта, либо');
  console.error('  2) установите PostgreSQL 14+ и создайте пользователя/базу из DATABASE_URL в server/.env.');
  console.error('Затем повторите: npm run setup');
  process.exit(1);
}
log('PostgreSQL доступен');

// ---------- 3. база данных ----------
const exists = await probe.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (!exists.rowCount) {
  await probe.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  log(`Создана база данных «${dbName}»`);
} else {
  log(`База данных «${dbName}» уже существует`);
}
await probe.end();

// ---------- 4. схема и данные ----------
for (const script of ['migrate.js', 'seed.js']) {
  const r = spawnSync(process.execPath, [`--env-file=${envPath}`, path.join('scripts', script)], { cwd: serverDir, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log('\n✓ База готова. Запуск: npm run dev (в server) и npm run dev (в client).');
if (generatedAdminPassword) {
  console.log(`  Администратор: ${env.ADMIN_EMAIL} / ${generatedAdminPassword}   (показан один раз; он же записан в server/.env)`);
} else {
  console.log(`  Администратор: ${env.ADMIN_EMAIL} (пароль — ADMIN_PASSWORD в server/.env).`);
}
console.log('  Демо-аккаунты (при SEED_DEMO=1): buyer@example.com, anna@example.com, пароль demo12345.');
