import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const sql = await readFile(fileURLToPath(new URL('../db/schema.sql', import.meta.url)), 'utf8');
try {
  await pool.query(sql);
  console.log('Миграция выполнена: таблицы созданы или уже существуют.');
} catch (e) {
  console.error('Ошибка миграции:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
