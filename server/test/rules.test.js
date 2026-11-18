// Тесты правил без БД: npm test (не требуют переменных окружения)
import test from 'node:test';
import assert from 'node:assert/strict';
import { canMove, NEXT } from '../src/statuses.js';
import { statusPatchSchema, registerSchema, requestSchema, commentSchema, listQuerySchema, cleanQuery, createUserSchema } from '../src/schemas.js';
import { isRealDate } from '../src/datecheck.js';
import { detectType, extensionMatches, cleanFileName, extOf, contentDisposition } from '../src/files.js';
import { errorHandler } from '../src/errors.js';

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

test('F1: несуществующие даты отклоняются', () => {
  assert.ok(isRealDate('2026-02-28'));
  assert.ok(isRealDate('2028-02-29'));
  assert.ok(!isRealDate('2026-02-31'));
  assert.ok(!isRealDate('2026-13-01'));
  assert.ok(!isRealDate('2026-2-1'));
  assert.ok(!isRealDate(20260101));
});

const good = { category_id: 1, justification: 'нужно', items: [{ name: 'Бумага', quantity: 2 }] };

test('заявка: позиции, количество, обоснование, дата', () => {
  assert.equal(requestSchema.parse(good).items[0].unit, 'шт.');
  assert.throws(() => requestSchema.parse({ ...good, items: [] }));
  assert.throws(() => requestSchema.parse({ ...good, items: [{ name: 'x', quantity: 0 }] }));
  assert.throws(() => requestSchema.parse({ ...good, items: [{ name: 'x', quantity: 1.5 }] }));
  assert.throws(() => requestSchema.parse({ ...good, justification: '   ' }));
  assert.throws(() => requestSchema.parse({ ...good, budget: -1 }));
  assert.throws(() => requestSchema.parse({ ...good, due_date: '2026-02-31' }), /Такой даты нет/);
  assert.ok(requestSchema.parse({ ...good, due_date: '2026-03-01' }));
});

test('F2: отклонение требует непустую причину в том же запросе', () => {
  assert.throws(() => statusPatchSchema.parse({ status: 'cancelled' }));
  assert.throws(() => statusPatchSchema.parse({ status: 'new' }));
  assert.throws(() => statusPatchSchema.parse({}));
  assert.throws(() => statusPatchSchema.parse({ status: 'rejected' }));
  assert.throws(() => statusPatchSchema.parse({ status: 'rejected', comment: '   ' }));
  assert.ok(statusPatchSchema.parse({ status: 'rejected', comment: 'Нет бюджета' }));
  assert.ok(statusPatchSchema.parse({ status: 'review' }));
});

test('C4: комментарий 1–1000 символов', () => {
  assert.throws(() => commentSchema.parse({ body: '   ' }));
  assert.throws(() => commentSchema.parse({ body: 'x'.repeat(1001) }));
  assert.equal(commentSchema.parse({ body: 'x'.repeat(1000) }).body.length, 1000);
});

test('регистрация и создание пользователя: пароль ≥ 8, email нормализуется', () => {
  assert.throws(() => registerSchema.parse({ full_name: 'Иван', email: 'a@b.co', password: '1234567' }));
  assert.equal(registerSchema.parse({ full_name: 'Иван', email: ' A@B.co ', password: '12345678' }).email, 'a@b.co');
  assert.equal(createUserSchema.parse({ full_name: 'Иван', email: 'a@b.co' }).role, 'employee');
  assert.throws(() => createUserSchema.parse({ full_name: 'Иван', email: 'a@b.co', role: 'root' }));
});

test('F6: параметры списка — значения по умолчанию, limit ≤ 100, пустые значения игнорируются', () => {
  const q = listQuerySchema.parse(cleanQuery({ status: '', q: '', page: '' }));
  assert.equal(q.page, 1);
  assert.equal(q.limit, 20);
  assert.throws(() => listQuerySchema.parse({ limit: '101' }));
  assert.throws(() => listQuerySchema.parse({ page: '0' }));
  assert.equal(listQuerySchema.parse({ assignee: '7' }).assignee, 7);
  assert.equal(listQuerySchema.parse({ assignee: 'none' }).assignee, 'none');
  assert.equal(listQuerySchema.parse({ urgent: '1' }).urgent, true);
  assert.throws(() => listQuerySchema.parse({ from: '2026-02-31' }));
});

test('F1: ошибки значений PostgreSQL → 400', () => {
  for (const code of ['22007', '22008', '22P02']) {
    let status;
    const res = { status(s) { status = s; return this; }, json() {} };
    errorHandler({ code }, { log: console }, res);
    assert.equal(status, 400, code);
  }
});

test('D1: определение типа файла по сигнатуре, а не по расширению', () => {
  const pad = Buffer.alloc(32);
  assert.equal(detectType(Buffer.concat([Buffer.from('%PDF-1.7\n'), pad])), 'pdf');
  assert.equal(detectType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad])), 'jpg');
  assert.equal(detectType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad])), 'png');
  assert.equal(detectType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), pad])), 'webp');
  assert.equal(detectType(Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('[Content_Types].xml word/document.xml'), pad])), 'docx');
  assert.equal(detectType(Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('[Content_Types].xml xl/workbook.xml'), pad])), 'xlsx');
  assert.equal(detectType(Buffer.concat([Buffer.from('PK\x03\x04'), pad])), null);
  assert.equal(detectType(Buffer.concat([Buffer.from('MZ'), pad])), null);
  assert.equal(detectType(Buffer.from('short')), null);
});

test('имена файлов: расширение, очистка пути, Content-Disposition', () => {
  assert.equal(extOf('Счёт.PDF'), 'pdf');
  assert.equal(extOf('a.jpeg'), 'jpg');
  assert.ok(extensionMatches('a.jpg', 'jpg'));
  assert.ok(!extensionMatches('a.pdf', 'jpg'));
  assert.equal(cleanFileName('../../etc/passwd'), 'passwd');
  assert.equal(cleanFileName('a"b<c>.pdf'), 'abc.pdf');
  const cd = contentDisposition('Счёт №1.pdf');
  assert.match(cd, /^attachment;/);
  assert.match(cd, /filename\*=UTF-8''/);
  assert.ok(!/[^\x20-\x7e]/.test(cd));
});
