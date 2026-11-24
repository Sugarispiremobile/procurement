import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { config } from './config.js';
import { query } from './db.js';
import { forbidden, unauthorized } from './errors.js';

/** Токен несёт версию (tv): блокировка, смена пароля и «выйти везде» увеличивают token_version и гасят старые токены. */
export const signToken = (user) =>
  jwt.sign({ sub: user.id, tv: user.token_version ?? 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

export const newInviteToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

/** Проверяет токен и загружает пользователя из БД (роль и блокировка всегда актуальны). */
export async function authenticate(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) throw unauthorized();
  let payload;
  try { payload = jwt.verify(m[1], config.jwtSecret); } catch { throw unauthorized('Сессия истекла, войдите снова'); }
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, u.role, u.department_id, d.name AS department,
            u.is_active, u.token_version, u.notify_email
       FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`,
    [payload.sub],
  );
  const u = rows[0];
  if (!u) throw unauthorized('Пользователь не найден');
  if (!u.is_active) throw unauthorized('Учётная запись заблокирована');
  if ((payload.tv ?? 0) !== u.token_version) throw unauthorized('Сессия завершена, войдите снова');
  req.user = u;
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) throw forbidden();
  next();
};

// A7: лимиты частоты. Ключ — req.ip (при выключенном TRUST_PROXY X-Forwarded-For игнорируется — A8).
const tooMany = (msg) => (req, res) => res.status(429).json({ error: msg });
const base = { standardHeaders: 'draft-7', legacyHeaders: false, validate: { xForwardedForHeader: false } };

/** Свои счётчики на каждый экземпляр приложения (удобно для тестов). */
export function createLimiters() {
  const loginMsg = 'Слишком много попыток входа. Попробуйте через 15 минут';
  return {
    loginIp: rateLimit({ ...base, windowMs: 15 * 60_000, limit: 50, skipSuccessfulRequests: true,
      keyGenerator: (req) => ipKeyGenerator(req.ip), handler: tooMany(loginMsg) }),
    // BUG-029: лимит неудачных попыток на один аккаунт независимо от IP
    loginEmail: rateLimit({ ...base, windowMs: 60 * 60_000, limit: 30, skipSuccessfulRequests: true,
      skip: (req) => !req.body?.email,
      keyGenerator: (req) => String(req.body.email).toLowerCase(), handler: tooMany(loginMsg) }),
    loginPair: rateLimit({ ...base, windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true,
      keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? '').toLowerCase()}`, handler: tooMany(loginMsg) }),
    register: rateLimit({ ...base, windowMs: 60 * 60_000, limit: 5,
      keyGenerator: (req) => ipKeyGenerator(req.ip), handler: tooMany('Слишком много регистраций. Попробуйте позже') }),
    invite: rateLimit({ ...base, windowMs: 15 * 60_000, limit: 30,
      keyGenerator: (req) => ipKeyGenerator(req.ip), handler: tooMany('Слишком много попыток. Попробуйте позже') }),
  };
}
