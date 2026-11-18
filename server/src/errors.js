import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const badRequest = (m, d) => new HttpError(400, m, d);
export const unauthorized = (m = 'Требуется вход') => new HttpError(401, m);
export const forbidden = (m = 'Недостаточно прав') => new HttpError(403, m);
export const notFound = (m = 'Не найдено') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);

/** Единый обработчик ошибок Express. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return res.status(400).json({ error: details[0]?.message || 'Неверные данные', details });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
  // F1: ошибки значений PostgreSQL — это 400, а не 500
  if (['22007', '22008', '22P02'].includes(err?.code)) return res.status(400).json({ error: 'Некорректное значение в запросе' });
  if (err?.code === '23503') return res.status(400).json({ error: 'Указана несуществующая связанная запись' });
  if (err?.code === '23505') return res.status(409).json({ error: 'Такая запись уже существует' });
  if (req.log) req.log.error({ err, userId: req.user?.id ?? null }, 'unhandled error'); else console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
}
