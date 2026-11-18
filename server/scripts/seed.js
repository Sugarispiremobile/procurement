import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, tx } from '../src/db.js';

const DEPARTMENTS = ['Бухгалтерия', 'ИТ', 'Производство', 'Склад', 'Администрация'];
const CATEGORIES = ['Канцелярия', 'Оборудование', 'Расходные материалы', 'Услуги', 'Другое'];

const hash = (p) => bcrypt.hash(p, 10);

async function upsertUser(c, { name, email, password, role, dept }) {
  const { rows } = await c.query(
    `INSERT INTO users (full_name, email, password_hash, role, department_id)
     VALUES ($1, lower($2), $3, $4, (SELECT id FROM departments WHERE name = $5))
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [name, email, await hash(password), role, dept ?? null],
  );
  if (rows[0]) return rows[0].id;
  return (await c.query('SELECT id FROM users WHERE email = lower($1)', [email])).rows[0].id;
}

async function addRequest(c, r) {
  const { rows } = await c.query(
    `INSERT INTO requests (author_id, category_id, is_urgent, due_date, budget, justification,
                           status, assignee_id, created_at, updated_at)
     VALUES ($1, (SELECT id FROM categories WHERE name = $2), $3, $4, $5, $6, $7, $8, $9, $9)
     RETURNING id`,
    [r.author, r.cat, r.urgent, r.due, r.budget, r.why, r.status, r.assignee ?? null, r.created],
  );
  const id = rows[0].id;
  if (r.note) {
    await c.query(
      'INSERT INTO request_comments (request_id, author_id, kind, body, created_at) VALUES ($1, $2, $3, $4, $5)',
      [id, r.assignee, r.status === 'rejected' ? 'rejection' : 'comment', r.note, r.created],
    );
  }
  for (const it of r.items) {
    await c.query('INSERT INTO request_items (request_id, name, quantity, unit) VALUES ($1,$2,$3,$4)', [
      id, it.name, it.quantity, it.unit,
    ]);
  }
  for (const h of r.hist) {
    await c.query(
      'INSERT INTO status_history (request_id, old_status, new_status, changed_by, changed_at) VALUES ($1,$2,$3,$4,$5)',
      [id, h.from, h.to, h.by, h.at],
    );
  }
}

try {
  await tx(async (c) => {
    for (const n of DEPARTMENTS) await c.query('INSERT INTO departments (name) VALUES ($1) ON CONFLICT DO NOTHING', [n]);
    for (const n of CATEGORIES) await c.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT DO NOTHING', [n]);

    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      // Пароль не хранится в репозитории: без ADMIN_PASSWORD генерируем случайный и печатаем один раз
      const generated = !process.env.ADMIN_PASSWORD;
      const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
      if (adminPassword.length < 8) throw new Error('ADMIN_PASSWORD: минимум 8 символов');
      const before = (await c.query('SELECT 1 FROM users WHERE email = lower($1)', [adminEmail])).rowCount;
      await upsertUser(c, {
        name: process.env.ADMIN_NAME || 'Администратор', email: adminEmail, password: adminPassword,
        role: 'admin', dept: 'Администрация',
      });
      if (!before && generated) {
        console.log(`\nАдминистратор: ${adminEmail.toLowerCase()}\nПароль (показан один раз, сохраните): ${adminPassword}\n`);
      } else console.log('Администратор:', adminEmail.toLowerCase());
    } else {
      console.log('ADMIN_EMAIL / ADMIN_PASSWORD не заданы — администратор не создан.');
    }

    if (process.env.SEED_DEMO === '1') {
      const anna = await upsertUser(c, { name: 'Анна Лебедева', email: 'anna@example.com', password: 'demo12345', role: 'employee', dept: 'Бухгалтерия' });
      const sergey = await upsertUser(c, { name: 'Сергей Орлов', email: 'sergey@example.com', password: 'demo12345', role: 'employee', dept: 'ИТ' });
      const buyer = await upsertUser(c, { name: 'Мария Снабженцева', email: 'buyer@example.com', password: 'demo12345', role: 'buyer', dept: 'Администрация' });

      const { rows } = await c.query('SELECT count(*)::int AS n FROM requests');
      if (rows[0].n === 0) {
        await addRequest(c, {
          author: anna, cat: 'Канцелярия', urgent: false, due: '2026-12-02', budget: 6500,
          why: 'Заканчиваются папки и бумага к закрытию квартала.', status: 'review', assignee: buyer, note: '', created: '2026-10-14T09:10:00Z',
          items: [{ name: 'Бумага А4, пачка 500 л.', quantity: 20, unit: 'пач.' }, { name: 'Папка-регистратор', quantity: 15, unit: 'шт.' }],
          hist: [{ from: null, to: 'new', by: anna, at: '2026-10-14T09:10:00Z' }, { from: 'new', to: 'review', by: buyer, at: '2026-10-15T07:30:00Z' }],
        });
        await addRequest(c, {
          author: sergey, cat: 'Оборудование', urgent: true, due: '2026-11-10', budget: 48000,
          why: 'Вышел из строя монитор у оператора склада.', status: 'buying', assignee: buyer, note: 'Поставщик выставил счёт, ждём оплаты.', created: '2026-10-16T08:00:00Z',
          items: [{ name: 'Монитор 24"', quantity: 2, unit: 'шт.' }],
          hist: [
            { from: null, to: 'new', by: sergey, at: '2026-10-16T08:00:00Z' },
            { from: 'new', to: 'review', by: buyer, at: '2026-10-16T10:20:00Z' },
            { from: 'review', to: 'buying', by: buyer, at: '2026-10-18T06:45:00Z' },
          ],
        });
      }
      console.log('Демо-данные добавлены (пароль демо-пользователей: demo12345).');
    }
  });
  console.log('Начальные данные загружены.');
} catch (e) {
  console.error('Ошибка загрузки данных:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
