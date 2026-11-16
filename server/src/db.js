import pg from 'pg';
import { config } from './config.js';

// DATE отдаём строкой 'YYYY-MM-DD', иначе драйвер превратит её в Date со сдвигом часового пояса
pg.types.setTypeParser(1082, (v) => v);
// NUMERIC (сумма) отдаём числом
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export const query = (text, params) => pool.query(text, params);

/** Выполняет fn(client) в одной транзакции. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
