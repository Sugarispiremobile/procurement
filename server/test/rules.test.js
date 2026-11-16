// Тесты правил без БД и без внешних пакетов, кроме zod: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { canMove, NEXT } from '../src/statuses.js';
import { requestSchema, statusPatchSchema, registerSchema } from '../src/schemas.js';

test('цепочка статусов и запрет пропуска этапов', () => {
  assert.ok(canMove('new', 'review'));
  assert.ok(canMove('review', 'buying'));
  assert.ok(canMove('buying', 'done'));
  assert.ok(canMove('buying', 'rejected'));
  assert.ok(!canMove('new', 'done'));
  assert.ok(!canMove('new', 'buying'));
});

test('из конечных статусов переходов нет', () => {
  for (const s of ['done', 'rejected', 'cancelled']) assert.equal(NEXT[s].length, 0);
  assert.ok(!canMove('done', 'review'));
});

test('снабжение не может ставить cancelled/new через PATCH', () => {
  assert.throws(() => statusPatchSchema.parse({ status: 'cancelled' }));
  assert.throws(() => statusPatchSchema.parse({ status: 'new' }));
  assert.throws(() => statusPatchSchema.parse({}));
  assert.ok(statusPatchSchema.parse({ comment: 'ok' }));
});

const good = { category_id: 1, justification: 'нужно', items: [{ name: 'Бумага', quantity: 2 }] };

test('заявка: минимум одна позиция, количество — целое > 0, обоснование обязательно', () => {
  assert.equal(requestSchema.parse(good).items[0].unit, 'шт.');
  assert.throws(() => requestSchema.parse({ ...good, items: [] }));
  assert.throws(() => requestSchema.parse({ ...good, items: [{ name: 'x', quantity: 0 }] }));
  assert.throws(() => requestSchema.parse({ ...good, items: [{ name: 'x', quantity: 1.5 }] }));
  assert.throws(() => requestSchema.parse({ ...good, justification: '   ' }));
  assert.throws(() => requestSchema.parse({ ...good, budget: -1 }));
});

test('регистрация: пароль минимум 8 символов, email приводится к нижнему регистру', () => {
  assert.throws(() => registerSchema.parse({ full_name: 'Иван', email: 'a@b.co', password: '1234567' }));
  const u = registerSchema.parse({ full_name: 'Иван', email: ' A@B.co ', password: '12345678' });
  assert.equal(u.email, 'a@b.co');
});
