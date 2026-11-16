import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError, forbidden } from './errors.js';

export const signToken = (user) =>
  jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

/** Проверяет токен и загружает пользователя из БД (роль всегда актуальная). */
export async function authenticate(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) throw new HttpError(401, 'Требуется вход');
  let payload;
  try {
    payload = jwt.verify(m[1], config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Сессия истекла, войдите снова');
  }
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, u.role, u.department_id, d.name AS department
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = $1`,
    [payload.sub],
  );
  if (!rows[0]) throw new HttpError(401, 'Пользователь не найден');
  req.user = rows[0];
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) throw forbidden();
  next();
};

/** Простейший ограничитель попыток входа (в памяти процесса). */
const attempts = new Map();
export function loginLimiter(req, res, next) {
  const key = `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`;
  const now = Date.now();
  const rec = (attempts.get(key) ?? []).filter((t) => now - t < 15 * 60 * 1000);
  if (rec.length >= 10) throw new HttpError(429, 'Слишком много попыток входа. Попробуйте через 15 минут');
  res.on('finish', () => {
    if (res.statusCode === 401) {
      rec.push(Date.now());
      attempts.set(key, rec);
    } else if (res.statusCode < 300) attempts.delete(key);
  });
  next();
}
