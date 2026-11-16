export const STATUSES = [
  { k: 'new', t: 'Новая', c: '#8c96a8' },
  { k: 'review', t: 'На согласовании', c: '#ffa51f' },
  { k: 'buying', t: 'В закупке', c: '#3b8bff' },
  { k: 'done', t: 'Выполнена', c: '#22b86a' },
  { k: 'rejected', t: 'Отклонена', c: '#ef4a3a' },
  { k: 'cancelled', t: 'Отменена', c: '#a3a095' },
];
export const ST = Object.fromEntries(STATUSES.map((s) => [s.k, s]));

// Должно совпадать с server/src/statuses.js (сервер проверяет переходы сам)
export const NEXT = {
  new: ['review', 'rejected'],
  review: ['buying', 'rejected'],
  buying: ['done', 'rejected'],
  done: [], rejected: [], cancelled: [],
};
export const CLOSED = ['done', 'rejected', 'cancelled'];

export const ROLES = { employee: 'Сотрудник', buyer: 'Снабжение', admin: 'Администратор' };

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('ru-RU') : '—');
export const fmtDT = (t) =>
  new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtMoney = (n) => (n ? `${Number(n).toLocaleString('ru-RU')} ₽` : '—');
export const isOverdue = (r) => Boolean(r.due_date) && r.due_date < todayStr() && !CLOSED.includes(r.status);

export const FLOW = ['new', 'review', 'buying', 'done'];
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
