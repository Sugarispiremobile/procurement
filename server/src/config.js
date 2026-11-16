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
};
