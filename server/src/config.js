import path from 'node:path';
import { fileURLToPath } from 'node:url';

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name} (см. .env.example)`);
  return v;
};

const isProd = process.env.NODE_ENV === 'production';
const jwtSecret = required('JWT_SECRET');
if (isProd && jwtSecret.length < 32) throw new Error('JWT_SECRET должен быть не короче 32 символов в production');

const timeZone = process.env.APP_TZ || 'Asia/Almaty';
try { new Intl.DateTimeFormat('en-CA', { timeZone }); } catch { throw new Error(`APP_TZ: неизвестный часовой пояс «${timeZone}»`); }

// TRUST_PROXY: пусто/0/false — не доверять; число — число прокси; true — 1; иначе значение для Express ("loopback")
const tp = process.env.TRUST_PROXY;
const trustProxy = !tp || tp === '0' || tp === 'false' ? false : /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? 1 : tp;

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  isProd,
  statementTimeoutMs: Number(process.env.STATEMENT_TIMEOUT_MS) || 60_000, // защита пула от тяжёлых запросов
  port: Number(process.env.PORT) || 3000,
  databaseUrl: required('DATABASE_URL'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  timeZone,
  currency: process.env.CURRENCY || '₸',
  trustProxy,
  allowedEmailDomain: (process.env.ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase().replace(/^@/, ''),
  appUrl: (process.env.APP_URL || `http://localhost:${process.env.CLIENT_PORT || 5173}`).replace(/\/$/, ''),
  inviteTtlHours: Number(process.env.INVITE_TTL_HOURS) || 72,
  uploadDir: path.resolve(serverDir, process.env.UPLOAD_DIR || 'uploads'),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === '1',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Заявки в снабжение <no-reply@localhost>',
  },
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
};
