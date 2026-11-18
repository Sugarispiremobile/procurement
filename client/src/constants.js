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

// Настройки приходят с сервера (/api/config) до первого показа страниц, см. ConfigProvider
export const cfg = { currency: '₸', timeZone: 'Asia/Almaty', registrationOpen: false, domain: null };

/** «Сегодня» в часовом поясе приложения (как на сервере), а не в поясе браузера. */
export const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('ru-RU') : '—');
export const fmtDT = (t) =>
  new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtMoney = (n) => (n ? `${Number(n).toLocaleString('ru-RU')} ${cfg.currency}` : '—');
export const fmtSize = (b) => (b < 1024 ? `${b} Б` : b < 1048576 ? `${Math.round(b / 1024)} КБ` : `${(b / 1048576).toFixed(1)} МБ`);
export const isOverdue = (r) => (typeof r.is_overdue === 'boolean' ? r.is_overdue : Boolean(r.due_date) && r.due_date < todayStr() && !CLOSED.includes(r.status));

export const FLOW = ['new', 'review', 'buying', 'done'];
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export const FIELD_NAMES = {
  category_id: 'категория', is_urgent: 'срочность', due_date: 'срок', budget: 'сумма', justification: 'обоснование', items: 'позиции',
};
export const FILE_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'xlsx', 'docx'];
export const MAX_FILE = 10 * 1024 * 1024;
export const MAX_FILES = 5;
