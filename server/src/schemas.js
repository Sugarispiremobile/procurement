import { z } from 'zod';

const text = (max) => z.string().trim().max(max);

export const todayStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Некорректная дата');

export const registerSchema = z.object({
  full_name: text(120).min(2, 'Укажите имя'),
  email: z.string().trim().toLowerCase().email('Некорректный email').max(200),
  password: z.string().min(8, 'Пароль — минимум 8 символов').max(100),
  department_id: z.number().int().positive().nullable().optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(100),
});

export const itemSchema = z.object({
  name: text(120).min(1, 'Название позиции обязательно'),
  quantity: z.number({ invalid_type_error: 'Количество — число' }).int('Количество — целое число').positive('Количество должно быть больше 0'),
  unit: text(12).default('шт.').transform((u) => u || 'шт.'),
});

export const requestSchema = z.object({
  category_id: z.number().int().positive(),
  is_urgent: z.boolean().default(false),
  due_date: date.nullable().optional(),
  budget: z.number().min(0, 'Сумма не может быть отрицательной').max(1e12).nullable().optional(),
  justification: text(1000).min(1, 'Обоснование обязательно'),
  items: z.array(itemSchema).min(1, 'Добавьте хотя бы одну позицию').max(50),
});

export const statusPatchSchema = z
  .object({
    status: z.enum(['review', 'buying', 'done', 'rejected']).optional(),
    comment: text(500).optional(),
  })
  .refine((v) => v.status !== undefined || v.comment !== undefined, 'Укажите статус и/или комментарий');

export const rolePatchSchema = z.object({ role: z.enum(['employee', 'buyer', 'admin']) });

export const dictSchema = z.object({ name: text(100).min(1, 'Название обязательно') });
