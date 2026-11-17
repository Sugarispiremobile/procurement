// Тесты правил без БД и без внешних пакетов, кроме zod: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { canMove, NEXT } from '../src/statuses.js';
import { requestSchema, statusPatchSchema, registerSchema, isRealDate } from '../src/schemas.js';
import { todayStr } from '../src/tz.js';
import { isEmailAllowed, parseDomains, parseTrustProxy } from '../src/policy.js';
import { describeEdit } from '../src/history.js';

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

test('несуществующие даты отклоняются (2026-02-31 не превращается в 3 марта)', () => {
  assert.ok(isRealDate('2026-02-28'));
  assert.ok(isRealDate('2028-02-29'));
  assert.ok(!isRealDate('2026-02-31'));
  assert.ok(!isRealDate('2026-13-01'));
  assert.ok(!isRealDate('2026-04-31'));
  assert.throws(() => requestSchema.parse({ ...good, due_date: '2026-02-31' }));
  assert.ok(requestSchema.parse({ ...good, due_date: '2026-03-01' }));
});

test('числа, не помещающиеся в БД, дают ошибку валидации, а не 500', () => {
  assert.throws(() => requestSchema.parse({ ...good, budget: 1e12 }));
  assert.ok(requestSchema.parse({ ...good, budget: 999_999_999_999.99 }));
  assert.throws(() => requestSchema.parse({ ...good, items: [{ name: 'x', quantity: 3e9 }] }));
  assert.throws(() => requestSchema.parse({ ...good, category_id: 3e9 }));
});

test('«сегодня» считается в заданном часовом поясе', () => {
  const t = new Date('2026-11-16T22:30:00Z'); // 03:30 17 ноября в Алматы, 22:30 16 ноября в UTC
  assert.equal(todayStr(t, 'Asia/Almaty'), '2026-11-17');
  assert.equal(todayStr(t, 'UTC'), '2026-11-16');
});

test('регистрация по списку доменов и разбор TRUST_PROXY', () => {
  const d = parseDomains(' Company.kz, @corp.com ,');
  assert.deepEqual(d, ['company.kz', 'corp.com']);
  assert.ok(isEmailAllowed('a@COMPANY.kz', d));
  assert.ok(!isEmailAllowed('a@evil.com', d));
  assert.ok(!isEmailAllowed('a@company.kz.evil.com', d));
  assert.ok(isEmailAllowed('a@any.com', []));
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
});

test('правка заявки описывается для истории', () => {
  const before = { category_id: 1, is_urgent: false, due_date: null, budget: 100, justification: 'a', items: [{ name: 'Монитор', quantity: 2, unit: 'шт.' }] };
  assert.equal(describeEdit(before, { ...before }), '');
  const after = { ...before, items: [{ name: 'Монитор', quantity: 5, unit: 'шт.' }], budget: 250 };
  const text = describeEdit(before, after);
  assert.match(text, /Монитор — 2 шт\. → Монитор — 5 шт\./);
  assert.match(text, /сумма: 100 → 250/);
});
