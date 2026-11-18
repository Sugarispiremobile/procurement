export const STATUSES = ['new', 'review', 'buying', 'done', 'rejected', 'cancelled'];

/** Допустимые переходы, которые выполняет снабжение. cancelled ставит только владелец (отдельный маршрут). */
export const NEXT = {
  new: ['review', 'rejected'], review: ['buying', 'rejected'], buying: ['done', 'rejected'],
  done: [], rejected: [], cancelled: [],
};
export const CLOSED = ['done', 'rejected', 'cancelled'];
export const isClosed = (s) => CLOSED.includes(s);
export const canMove = (from, to) => (NEXT[from] ?? []).includes(to);
export const STATUS_RU = {
  new: 'Новая', review: 'На согласовании', buying: 'В закупке', done: 'Выполнена', rejected: 'Отклонена', cancelled: 'Отменена',
};
