import { HttpError } from './errors.js';

/**
 * Ограничитель частоты в памяти процесса.
 * Запрос учитывается сразу при входе (параллельный перебор не обходит лимит), а после ответа
 * запись снимается, если refund(statusCode) вернул true. Старые записи периодически удаляются.
 */
export function createLimiter({ windowMs, max, message, key, refund = () => false, resetOnSuccess = false }) {
  const hits = new Map();

  const prune = () => {
    const now = Date.now();
    for (const [k, arr] of hits) {
      const fresh = arr.filter((t) => now - t < windowMs);
      if (fresh.length) hits.set(k, fresh);
      else hits.delete(k);
    }
  };
  setInterval(prune, Math.min(windowMs, 60_000)).unref();

  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    const rec = (hits.get(k) ?? []).filter((t) => now - t < windowMs);
    if (rec.length >= max) {
      hits.set(k, rec);
      throw new HttpError(429, message);
    }
    const stamp = now + rec.length / 1e6; // уникальная метка записи
    rec.push(stamp);
    hits.set(k, rec);
    res.on('finish', () => {
      if (resetOnSuccess && res.statusCode < 300) return void hits.delete(k);
      if (refund(res.statusCode)) {
        const cur = hits.get(k);
        if (!cur) return;
        const left = cur.filter((t) => t !== stamp);
        if (left.length) hits.set(k, left);
        else hits.delete(k);
      }
    });
    next();
  };
}

const MIN15 = 15 * 60 * 1000;
const notFailure = (status) => status !== 401; // в счётчик входа попадают только неверные пароли

/** 10 неудачных попыток на пару IP + email за 15 минут. */
export const loginLimiter = createLimiter({
  windowMs: MIN15,
  max: 10,
  message: 'Слишком много попыток входа. Попробуйте через 15 минут',
  key: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase().slice(0, 200)}`,
  refund: notFailure,
  resetOnSuccess: true,
});

/** Общий лимит на IP: перебор паролей по многим email. */
export const loginIpLimiter = createLimiter({
  windowMs: MIN15,
  max: 30,
  message: 'Слишком много попыток входа с вашего адреса. Попробуйте позже',
  key: (req) => req.ip,
  refund: notFailure,
});

/** Регистрация: bcrypt нагружает CPU. */
export const registerLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Слишком много регистраций с вашего адреса. Попробуйте позже',
  key: (req) => req.ip,
});
