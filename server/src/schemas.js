import { z } from 'zod';
import { isRealDate } from './datecheck.js';

// BUG-013: русские сообщения по умолчанию (свои сообщения правил имеют приоритет)
const FIELD_RU = {
  category_id: 'Категория', department_id: 'Подразделение', assignee_id: 'Ответственный', quantity: 'Количество',
  budget: 'Сумма', justification: 'Обоснование', items: 'Позиции', name: 'Название', unit: 'Единица', due_date: 'Дата «нужно к»',
  full_name: 'Имя', email: 'Email', password: 'Пароль', body: 'Комментарий', status: 'Статус', comment: 'Комментарий',
  page: 'Страница', limit: 'Размер страницы', category: 'Категория', department: 'Подразделение', assignee: 'Ответственный',
  from: 'Дата «с»', to: 'Дата «по»', role: 'Роль', token: 'Токен', is_urgent: 'Срочность',
};
const fieldLabel = (path) => FIELD_RU[[...path].reverse().find((p) => typeof p === 'string')];
z.config({
  customError: (iss) => {
    const f = fieldLabel(iss.path ?? []);
    const pre = f ? `${f}: ` : '';
    switch (iss.code) {
      case 'invalid_type': return `${pre}${iss.input === undefined ? 'обязательное поле' : 'неверный тип значения'}`;
      case 'too_small': return `${pre}${iss.origin === 'string' ? 'слишком короткое значение' : iss.origin === 'array' ? 'слишком мало элементов' : 'значение слишком мало'}`;
      case 'too_big': return `${pre}${iss.origin === 'string' ? 'слишком длинное значение' : iss.origin === 'array' ? 'слишком много элементов' : 'значение слишком велико'}`;
      case 'invalid_value': case 'invalid_union': case 'not_multiple_of': return `${pre}недопустимое значение`;
      default: return `${pre}некорректное значение`;
    }
  },
});

const PG_INT_MAX = 2147483647;
const text = (max) => z.string().trim().max(max);
const emailField = z.string().trim().toLowerCase().email('Некорректный email').max(200);
// BUG-027: bcrypt учитывает только первые 72 байта, поэтому ограничиваем длину в байтах
const password = z.string().min(8, 'Пароль — минимум 8 символов').max(100)
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Пароль слишком длинный: максимум 72 байта (около 36 русских или 72 латинских символов)');
const id = z.number().int().positive().max(PG_INT_MAX);

// F1: дата должна существовать (2026-02-31 — нет)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД').refine(isRealDate, 'Такой даты нет');

export const registerSchema = z.object({
  full_name: text(120).min(2, 'Укажите имя'), email: emailField, password, department_id: id.nullable().optional(),
});
export const loginSchema = z.object({ email: emailField, password: z.string().min(1).max(100) });
export const acceptInviteSchema = z.object({ token: z.string().min(10).max(200), password });
export const changePasswordSchema = z.object({ current_password: z.string().min(1).max(100), new_password: password });
export const meSchema = z
  .object({ notify_email: z.boolean().optional(), full_name: text(120).min(2, 'Укажите имя').optional() })
  .refine((v) => Object.keys(v).length > 0, 'Нет данных для изменения');

export const createUserSchema = z.object({
  full_name: text(120).min(2, 'Укажите имя'), email: emailField,
  role: z.enum(['employee', 'buyer', 'admin']).default('employee'), department_id: id.nullable().optional(),
});
export const userPatchSchema = z
  .object({
    role: z.enum(['employee', 'buyer', 'admin']).optional(), is_active: z.boolean().optional(),
    department_id: id.nullable().optional(), full_name: text(120).min(2, 'Укажите имя').optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Нет данных для изменения');

export const dictSchema = z.object({ name: text(100).min(1, 'Название обязательно') });
export const dictPatchSchema = z
  .object({ name: text(100).min(1, 'Название обязательно').optional(), is_archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Нет данных для изменения');

export const itemSchema = z.object({
  name: text(120).min(1, 'Название позиции обязательно'),
  quantity: z.number({ error: 'Количество — число' }).int('Количество — целое число').positive('Количество должно быть больше 0').max(1_000_000, 'Количество не может быть больше 1 000 000'),
  unit: text(12).default('шт.').transform((u) => u || 'шт.'),
});
export const requestSchema = z.object({
  category_id: id,
  is_urgent: z.boolean().default(false),
  due_date: date.nullable().optional(),
  budget: z.number({ error: 'Сумма — число' }).min(0, 'Сумма не может быть отрицательной').max(999_999_999_999.99, 'Сумма слишком большая').multipleOf(0.01, 'Сумма — не более двух знаков после запятой').nullable().optional(),
  justification: text(1000).min(1, 'Обоснование обязательно'),
  items: z.array(itemSchema).min(1, 'Добавьте хотя бы одну позицию').max(50),
});

// F2: при отклонении причина обязательна в том же запросе
export const statusPatchSchema = z
  .object({ status: z.enum(['review', 'buying', 'done', 'rejected']), comment: text(1000).optional() })
  .refine((v) => v.status !== 'rejected' || (v.comment ?? '').length > 0, {
    message: 'При отклонении укажите причину в комментарии', path: ['comment'],
  });

export const commentSchema = z.object({ body: text(1000).min(1, 'Комментарий не может быть пустым') });
export const assignSchema = z.object({ assignee_id: id.nullable().optional() });

export const cleanQuery = (q) => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '' && v != null));
const flag = z.enum(['1', 'true']).optional().transform((v) => v !== undefined);
const idParam = z.coerce.number().int().positive().max(PG_INT_MAX);

export const listQuerySchema = z.object({
  status: z.enum(['new', 'review', 'buying', 'done', 'rejected', 'cancelled']).optional(),
  q: z.string().max(200).optional(),
  assignee: z.union([z.enum(['me', 'none', 'all']), idParam]).optional(),
  category: idParam.optional(), department: idParam.optional(),
  urgent: flag, overdue: flag, from: date.optional(), to: date.optional(),
  page: z.coerce.number().int().min(1).max(1e6).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const statsQuerySchema = z.object({ from: date.optional(), to: date.optional() });
