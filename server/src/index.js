import { config } from './config.js';
import { pool } from './db.js';
import { createApp, logger } from './app.js';
import { migrate } from '../scripts/migrate.js';

// Миграции применяются при старте (идемпотентно); ошибку БД показываем понятно
try {
  await pool.query('SELECT 1');
  await migrate(pool, (m) => logger.info(m));
} catch (e) {
  console.error(`Не удалось подготовить базу данных: ${e.code || e.message}`);
  console.error('Выполните: npm run setup   (создаст .env, поднимет PostgreSQL через Docker и загрузит данные)');
  process.exit(1);
}

const app = createApp();
const server = app.listen(config.port, () => logger.info(`Сервер запущен: http://localhost:${config.port}`));

const shutdown = async () => { server.close(); await pool.end(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
