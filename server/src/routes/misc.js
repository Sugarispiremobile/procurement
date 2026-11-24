import { Router } from 'express';
import { query, tx } from '../db.js';
import { authenticate, requireRole } from '../auth.js';
import { conflict, notFound } from '../errors.js';
import { createInvite } from '../invites.js';
import { CLOSED } from '../statuses.js';
import { dictSchema, dictPatchSchema, createUserSchema, userPatchSchema, statsQuerySchema, cleanQuery } from '../schemas.js';

const parseId = (v, msg = 'Не найдено') => {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw notFound(msg);
  return id;
};

/** Справочники: /api/categories, /api/departments */
export function dictionaryRouter(table, { publicRead = false } = {}) {
  const router = Router();
  const list = (withArchived) => async (req, res) => {
    const { rows } = await query(`SELECT id, name, is_archived FROM ${table} ${withArchived ? '' : 'WHERE NOT is_archived'} ORDER BY name`);
    res.json({ items: rows });
  };
  if (publicRead) router.get('/', list(false)); // подразделения нужны на странице регистрации
  else router.get('/', authenticate, list(false));
  router.get('/all', authenticate, requireRole('admin'), list(true)); // с архивными — для экрана управления

  router.post('/', authenticate, requireRole('admin'), async (req, res) => {
    const { name } = dictSchema.parse(req.body);
    if ((await query(`SELECT 1 FROM ${table} WHERE lower(name) = lower($1)`, [name])).rowCount) throw conflict('Такое название уже есть');
    const { rows } = await query(`INSERT INTO ${table} (name) VALUES ($1) RETURNING id, name, is_archived`, [name]);
    res.status(201).json(rows[0]);
  });

  router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
    const id = parseId(req.params.id);
    const d = dictPatchSchema.parse(req.body);
    if (d.name && (await query(`SELECT 1 FROM ${table} WHERE lower(name) = lower($1) AND id <> $2`, [d.name, id])).rowCount) {
      throw conflict('Такое название уже есть');
    }
    const { rows } = await query(
      `UPDATE ${table} SET name = COALESCE($2, name), is_archived = COALESCE($3, is_archived) WHERE id = $1 RETURNING id, name, is_archived`,
      [id, d.name ?? null, d.is_archived ?? null]);
    if (!rows[0]) throw notFound();
    res.json(rows[0]);
  });
  return router;
}

/** Пользователи: только admin */
export const usersRouter = Router();
usersRouter.use(authenticate, requireRole('admin'));

const USER_ROW = `SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.created_at, u.department_id, d.name AS department,
                         (u.password_hash IS NULL) AS pending_invite
                    FROM users u LEFT JOIN departments d ON d.id = u.department_id`;

usersRouter.get('/', async (req, res) => {
  res.json({ users: (await query(`${USER_ROW} ORDER BY u.created_at, u.id`)).rows });
});

// A2: создание пользователя + ссылка-приглашение
usersRouter.post('/', async (req, res) => {
  const d = createUserSchema.parse(req.body);
  if ((await query('SELECT 1 FROM users WHERE email = $1', [d.email])).rowCount) throw conflict('Пользователь с таким email уже есть');
  const out = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users (full_name, email, password_hash, role, department_id) VALUES ($1, $2, NULL, $3, $4) RETURNING id, full_name, email`,
      [d.full_name, d.email, d.role, d.department_id ?? null]);
    return { user: rows[0], invite: await createInvite(c, rows[0]) };
  });
  out.invite.send();
  const user = (await query(`${USER_ROW} WHERE u.id = $1`, [out.user.id])).rows[0];
  res.status(201).json({ user, invite_url: out.invite.invite_url, expires_at: out.invite.expires_at });
});

// Роль, блокировка (A3), подразделение, имя
usersRouter.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id, 'Пользователь не найден');
  const d = userPatchSchema.parse(req.body);
  if (id === req.user.id) {
    if (d.is_active === false) throw conflict('Нельзя заблокировать самого себя');
    if (d.role && d.role !== 'admin') throw conflict('Нельзя снять роль администратора с самого себя');
  }
  // Пользователь и снятие с заявок — в одной транзакции
  const found = await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE users SET role = COALESCE($2, role), is_active = COALESCE($3, is_active), full_name = COALESCE($4, full_name),
                        department_id = CASE WHEN $5::boolean THEN $6::int ELSE department_id END,
                        token_version = token_version + CASE WHEN $3::boolean IS NOT NULL AND $3::boolean = false THEN 1 ELSE 0 END
        WHERE id = $1 RETURNING id, role, is_active, full_name`,
      [id, d.role ?? null, d.is_active ?? null, d.full_name ?? null, 'department_id' in d, d.department_id ?? null]);
    const u = rows[0];
    if (!u) return false;
    // BUG-012: блокировка гасит неиспользованные приглашения
    if (!u.is_active) await c.query('UPDATE invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [id]);
    // Заблокированный или ставший employee не может вести заявки: снимаем с открытых
    if (!u.is_active || u.role === 'employee') {
      const freed = await c.query(
        `UPDATE requests SET assignee_id = NULL, updated_at = now()
          WHERE assignee_id = $1 AND status <> ALL($2::text[]) RETURNING id`, [id, CLOSED]);
      for (const r of freed.rows) {
        await c.query(
          `INSERT INTO status_history (request_id, event, old_status, new_status, changed_by, details) VALUES ($1, 'assigned', NULL, NULL, $2, $3)`,
          [r.id, req.user.id, { assignee_id: null, assignee_name: null, previous_name: u.full_name, auto: true,
            reason: u.is_active ? 'role_changed' : 'blocked' }]);
      }
    }
    return true;
  });
  if (!found) throw notFound('Пользователь не найден');
  res.json((await query(`${USER_ROW} WHERE u.id = $1`, [id])).rows[0]);
});

// A5: сброс пароля — старый перестаёт работать, пользователь получает ссылку
usersRouter.post('/:id/reset-password', async (req, res) => {
  const id = parseId(req.params.id, 'Пользователь не найден');
  if (id === req.user.id) throw conflict('Нельзя сбросить пароль самому себе — используйте смену пароля в профиле');
  const out = await tx(async (c) => {
    const { rows } = await c.query(
      'UPDATE users SET password_hash = NULL, token_version = token_version + 1 WHERE id = $1 RETURNING id, full_name, email', [id]);
    if (!rows[0]) throw notFound('Пользователь не найден');
    return createInvite(c, rows[0], { reset: true });
  });
  out.send();
  res.json({ invite_url: out.invite_url, expires_at: out.expires_at });
});

/** Статистика для снабжения: /api/stats?from=&to= (по дате создания) */
export const statsRouter = Router();
statsRouter.get('/', authenticate, requireRole('buyer', 'admin'), async (req, res) => {
  const { from, to } = statsQuerySchema.parse(cleanQuery(req.query));
  const closed = CLOSED.map((s) => `'${s}'`).join(', ');
  const where = `WHERE ($1::date IS NULL OR created_at >= $1::date) AND ($2::date IS NULL OR created_at < $2::date + 1)`;
  const { rows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status NOT IN (${closed}))::int AS active,
            count(*) FILTER (WHERE status NOT IN (${closed}) AND is_urgent)::int AS urgent_active,
            count(*) FILTER (WHERE status NOT IN (${closed}) AND due_date < CURRENT_DATE)::int AS overdue,
            count(*) FILTER (WHERE status NOT IN (${closed}) AND assignee_id IS NULL)::int AS unassigned
       FROM requests ${where}`, [from ?? null, to ?? null]);
  const byStatus = await query(`SELECT status, count(*)::int AS n FROM requests ${where} GROUP BY status`, [from ?? null, to ?? null]);
  res.json({ ...rows[0], by_status: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])) });
});
