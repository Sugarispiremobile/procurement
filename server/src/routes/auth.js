import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { authenticate, signToken, loginLimiter } from '../auth.js';
import { conflict, HttpError } from '../errors.js';
import { registerSchema, loginSchema } from '../schemas.js';

const router = Router();

const publicUser = (u) => ({
  id: u.id, full_name: u.full_name, email: u.email, role: u.role,
  department_id: u.department_id ?? null, department: u.department ?? null,
});

// Хеш-заглушка: сравнение выполняется даже для несуществующего email, чтобы не выдавать его наличие по времени ответа
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

router.post('/register', async (req, res) => {
  const data = registerSchema.parse(req.body);
  const exists = await query('SELECT 1 FROM users WHERE email = $1', [data.email]);
  if (exists.rowCount) throw conflict('Пользователь с таким email уже зарегистрирован');
  const hash = await bcrypt.hash(data.password, 10);
  // Роль при регистрации всегда employee
  const { rows } = await query(
    `INSERT INTO users (full_name, email, password_hash, role, department_id)
     VALUES ($1, $2, $3, 'employee', $4) RETURNING id`,
    [data.full_name, data.email, hash, data.department_id ?? null],
  );
  const { rows: u } = await query(
    `SELECT u.id, u.full_name, u.email, u.role, u.department_id, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`,
    [rows[0].id],
  );
  res.status(201).json({ token: signToken(u[0]), user: publicUser(u[0]) });
});

router.post('/login', loginLimiter, async (req, res) => {
  const data = loginSchema.parse(req.body);
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, u.role, u.password_hash, u.department_id, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.email = $1`,
    [data.email],
  );
  const user = rows[0];
  const ok = await bcrypt.compare(data.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Неверный email или пароль');
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
