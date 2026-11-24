import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(1082, (v) => v); // DATE строкой, без сдвига часового пояса
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // NUMERIC числом

// F5: каждое соединение работает в APP_TZ, поэтому CURRENT_DATE = «сегодня» в APP_TZ
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, options: `-c TimeZone=${config.timeZone} -c statement_timeout=${config.statementTimeoutMs}` });

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
