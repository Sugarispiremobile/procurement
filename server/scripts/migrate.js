// Версионные миграции: db/migrations/NNN_*.sql по порядку, каждая в своей транзакции; журнал — schema_migrations.
// База версии 1.0 (создана старым schema.sql) распознаётся и получает отметку о 001.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function migrate(pool, log = console.log) {
  const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727001)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    if (!done.size) {
      const legacy = await c.query(`SELECT to_regclass('public.requests') AS t`);
      if (legacy.rows[0].t && files[0]) {
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [files[0]]);
        done.add(files[0]);
        log(`База версии 1.0 распознана: ${files[0]} отмечена применённой`);
      }
    }
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      try {
        await c.query('BEGIN');
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw new Error(`Миграция ${f}: ${e.message}`);
      }
      log(`Применена миграция ${f}`);
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    c.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pool } = await import('../src/db.js');
  try {
    await migrate(pool);
    console.log('Миграции актуальны.');
  } catch (e) {
    console.error('Ошибка миграции:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
