import { Router } from 'express';
import { query } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { conflict, notFound } from '../errors.js';
import { dictSchema, rolePatchSchema, activePatchSchema } from '../schemas.js';
import { APP_TIMEZONE } from '../tz.js';

const userId = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw notFound('Пользователь не найден');
  return id;
};

/** Справочники: /api/categories, /api/departments */
export function dictionaryRouter(table, { publicRead = false } = {}) {
  const router = Router();
  const list = async (req, res) => {
    const { rows } = await query(`SELECT id, name FROM ${table} ORDER BY name`);
    res.json({ items: rows });
  };
  if (publicRead) router.get('/', list); // подразделения нужны на странице регистрации
  else router.get('/', authenticate, list);

  router.post('/', authenticate, requireRole('admin'), async (req, res) => {
    const { name } = dictSchema.parse(req.body);
    const dup = await query(`SELECT 1 FROM ${table} WHERE lower(name) = lower($1)`, [name]);
    if (dup.rowCount) throw conflict('Такое название уже есть');
    const { rows } = await query(`INSERT INTO ${table} (name) VALUES ($1) RETURNING id, name`, [name]);
    res.status(201).json(rows[0]);
  });
  return router;
}

/** Пользователи: только admin */
export const usersRouter = Router();
usersRouter.use(authenticate, requireRole('admin'));

usersRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.created_at, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      ORDER BY u.created_at, u.id`,
  );
  res.json({ users: rows });
});

usersRouter.patch('/:id/role', async (req, res) => {
  const id = userId(req.params.id);
  const { role } = rolePatchSchema.parse(req.body);
  if (id === req.user.id && role !== 'admin') {
    throw conflict('Нельзя снять роль администратора с самого себя');
  }
  const { rows } = await query(
    'UPDATE users SET role = $2 WHERE id = $1 RETURNING id, full_name, email, role',
    [id, role],
  );
  if (!rows[0]) throw notFound('Пользователь не найден');
  res.json(rows[0]);
});

// Блокировка/разблокировка: отключённый пользователь не может войти, его токен перестаёт работать сразу
usersRouter.patch('/:id/active', async (req, res) => {
  const id = userId(req.params.id);
  const { is_active } = activePatchSchema.parse(req.body);
  if (id === req.user.id && !is_active) throw conflict('Нельзя отключить самого себя');
  const { rows } = await query(
    'UPDATE users SET is_active = $2 WHERE id = $1 RETURNING id, full_name, email, role, is_active',
    [id, is_active],
  );
  if (!rows[0]) throw notFound('Пользователь не найден');
  res.json(rows[0]);
});

/** Статистика для снабжения: /api/stats */
export const statsRouter = Router();
statsRouter.get('/', authenticate, requireRole('buyer', 'admin'), async (req, res) => {
  const { rows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status NOT IN ('done','rejected','cancelled'))::int AS active,
            count(*) FILTER (WHERE status NOT IN ('done','rejected','cancelled') AND is_urgent)::int AS urgent_active,
            count(*) FILTER (WHERE status NOT IN ('done','rejected','cancelled') AND due_date < (now() AT TIME ZONE $1)::date)::int AS overdue
       FROM requests`,
    [APP_TIMEZONE],
  );
  const byStatus = await query('SELECT status, count(*)::int AS n FROM requests GROUP BY status');
  res.json({ ...rows[0], by_status: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])) });
});
