import { parseDomains, parseTrustProxy } from './policy.js';

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name} (см. .env.example)`);
  return v;
};

const isProd = process.env.NODE_ENV === 'production';
const jwtSecret = required('JWT_SECRET');
if (isProd && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET должен быть не короче 32 символов в production');
}

export const config = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  databaseUrl: required('DATABASE_URL'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  // за обратным прокси (nginx и т.п.) укажите число прокси, напр. TRUST_PROXY=1; иначе пусто
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  // регистрация только с этих доменов, напр. ALLOWED_EMAIL_DOMAINS=company.kz; пусто — любой email
  allowedEmailDomains: parseDomains(process.env.ALLOWED_EMAIL_DOMAINS),
};
