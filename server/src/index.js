import { config } from './config.js';
import { pool } from './db.js';
import { createApp } from './app.js';

// Проверяем базу до старта, чтобы ошибка была понятной, а не россыпью 500 в браузере
try {
  await pool.query('SELECT 1');
  const { rows } = await pool.query(`SELECT to_regclass('public.requests') AS t`);
  if (!rows[0].t) {
    console.error('В базе нет таблиц. Выполните: npm run setup');
    process.exit(1);
  }
} catch (e) {
  console.error(`Нет подключения к базе данных (${e.code || e.message}).`);
  console.error('Выполните: npm run setup   (создаст .env, поднимет PostgreSQL через Docker и загрузит данные)');
  process.exit(1);
}

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Сервер запущен: http://localhost:${config.port}`);
});

const shutdown = async () => {
  server.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
