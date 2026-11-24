import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, tx } from '../db.js';
import { config } from '../config.js';
import { authenticate, signToken, hashToken } from '../auth.js';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../errors.js';
import { registerSchema, loginSchema, acceptInviteSchema, changePasswordSchema, meSchema } from '../schemas.js';

const publicUser = (u) => ({
  id: u.id, full_name: u.full_name, email: u.email, role: u.role,
  department_id: u.department_id ?? null, department: u.department ?? null, notify_email: u.notify_email ?? true,
});

const USER_SQL = `SELECT u.id, u.full_name, u.email, u.role, u.department_id, d.name AS department,
                         u.is_active, u.token_version, u.notify_email, u.password_hash
                    FROM users u LEFT JOIN departments d ON d.id = u.department_id`;

// Сравнение выполняется даже для несуществующего email — иначе email можно «пробить» по времени ответа
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

export default function authRoutes(limiters) {
  const router = Router();

  // A1: саморегистрация только для корпоративного домена
  router.post('/register', limiters.register, async (req, res) => {
    if (!config.allowedEmailDomain) throw forbidden('Регистрация отключена. Обратитесь к администратору');
    const data = registerSchema.parse(req.body);
    if (!data.email.endsWith(`@${config.allowedEmailDomain}`)) {
      throw forbidden(`Регистрация доступна только для адресов @${config.allowedEmailDomain}`);
    }
    if ((await query('SELECT 1 FROM users WHERE email = $1', [data.email])).rowCount) {
      throw conflict('Пользователь с таким email уже зарегистрирован');
    }
    if (data.department_id) {
      const d = await query('SELECT 1 FROM departments WHERE id = $1 AND NOT is_archived', [data.department_id]);
      if (!d.rowCount) throw badRequest('Подразделение не найдено');
    }
    const hash = await bcrypt.hash(data.password, 10);
    const { rows } = await query(
      `INSERT INTO users (full_name, email, password_hash, role, department_id) VALUES ($1, $2, $3, 'employee', $4) RETURNING id`,
      [data.full_name, data.email, hash, data.department_id ?? null],
    );
    const u = (await query(`${USER_SQL} WHERE u.id = $1`, [rows[0].id])).rows[0];
    res.status(201).json({ token: signToken(u), user: publicUser(u) });
  });

  router.post('/login', limiters.loginIp, limiters.loginEmail, limiters.loginPair, async (req, res) => {
    const data = loginSchema.parse(req.body);
    const user = (await query(`${USER_SQL} WHERE u.email = $1`, [data.email])).rows[0];
    const ok = await bcrypt.compare(data.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !user.password_hash || !ok) throw unauthorized('Неверный email или пароль');
    if (!user.is_active) throw unauthorized('Учётная запись заблокирована');
    res.json({ token: signToken(user), user: publicUser(user) });
  });

  router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

  router.patch('/me', authenticate, async (req, res) => {
    const d = meSchema.parse(req.body);
    await query('UPDATE users SET notify_email = COALESCE($2, notify_email), full_name = COALESCE($3, full_name) WHERE id = $1',
      [req.user.id, d.notify_email ?? null, d.full_name ?? null]);
    const u = (await query(`${USER_SQL} WHERE u.id = $1`, [req.user.id])).rows[0];
    res.json({ user: publicUser(u) });
  });

  // ---------- приглашения (A2, A5) ----------
  const findInvite = async (db, token, lock = false) => {
    const { rows } = await db.query(
      `SELECT i.token_hash, i.user_id, u.full_name, u.email
         FROM invites i JOIN users u ON u.id = i.user_id
        WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now() AND u.is_active ${lock ? 'FOR UPDATE OF i' : ''}`,
      [hashToken(token)],
    );
    if (!rows[0]) throw notFound('Ссылка недействительна или устарела. Попросите администратора выдать новую');
    return rows[0];
  };

  router.get('/invite/:token', limiters.invite, async (req, res) => {
    const i = await findInvite({ query }, String(req.params.token));
    res.json({ full_name: i.full_name, email: i.email });
  });

  router.post('/accept-invite', limiters.invite, async (req, res) => {
    const { token, password } = acceptInviteSchema.parse(req.body);
    const hash = await bcrypt.hash(password, 10);
    const user = await tx(async (c) => {
      const i = await findInvite(c, token, true);
      await c.query('UPDATE invites SET used_at = now() WHERE token_hash = $1', [i.token_hash]);
      await c.query('UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1', [i.user_id, hash]);
      return (await c.query(`${USER_SQL} WHERE u.id = $1`, [i.user_id])).rows[0];
    });
    if (!user.is_active) throw unauthorized('Учётная запись заблокирована');
    res.json({ token: signToken(user), user: publicUser(user) });
  });

  // ---------- пароль и сессии (A4, A6) ----------
  router.post('/change-password', authenticate, async (req, res) => {
    const { current_password, new_password } = changePasswordSchema.parse(req.body);
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0].password_hash || !(await bcrypt.compare(current_password, rows[0].password_hash))) {
      throw new HttpError(400, 'Текущий пароль указан неверно');
    }
    const hash = await bcrypt.hash(new_password, 10);
    const { rows: u } = await query(
      'UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING id, token_version',
      [req.user.id, hash]);
    res.json({ token: signToken(u[0]) });
  });

  router.post('/logout-all', authenticate, async (req, res) => {
    await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
    res.status(204).end();
  });

  return router;
}
