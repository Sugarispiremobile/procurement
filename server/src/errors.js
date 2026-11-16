import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (m, d) => new HttpError(400, m, d);
export const forbidden = (m = 'Недостаточно прав') => new HttpError(403, m);
export const notFound = (m = 'Не найдено') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);

/** Единый обработчик ошибок Express. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return res.status(400).json({ error: 'Неверные данные', details });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON' });
  }
  if (err?.code === '23503') return res.status(400).json({ error: 'Указана несуществующая связанная запись' });
  if (err?.code === '23505') return res.status(409).json({ error: 'Такая запись уже существует' });
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
}
