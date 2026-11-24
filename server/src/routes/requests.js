import { Router, raw } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { query, tx } from '../db.js';
import { config } from '../config.js';
import { requireRole } from '../auth.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { requestSchema, statusPatchSchema, commentSchema, assignSchema, listQuerySchema, cleanQuery } from '../schemas.js';
import { todayStr } from '../dates.js';
import { STATUS_RU, CLOSED, canMove, isClosed } from '../statuses.js';
import { notifyUsers } from '../mailer.js';
import {
  MAX_FILE_BYTES, MAX_FILES_PER_REQUEST, MIME, detectType, extensionMatches, cleanFileName, contentDisposition,
} from '../files.js';

const router = Router();

// BUG-003: разделение обязанностей — собственную заявку снабженец не ведёт (администратор — исключение)
const SELF_MSG = 'Собственную заявку не может вести её автор — её обработает другой сотрудник снабжения';

const CLOSED_SQL = CLOSED.map((s) => `'${s}'`).join(', ');
const OVERDUE_SQL = `COALESCE(r.due_date < CURRENT_DATE AND r.status NOT IN (${CLOSED_SQL}), false)`;

const SELECT_REQUEST = `
  SELECT r.id, r.is_urgent, r.due_date, r.budget, r.justification, r.status,
         r.created_at, r.updated_at,
         u.id AS author_id, u.full_name AS author_name, d.name AS department,
         c.id AS category_id, c.name AS category,
         r.assignee_id, a.full_name AS assignee_name,
         (SELECT cm.body FROM request_comments cm WHERE cm.request_id = r.id ORDER BY cm.id DESC LIMIT 1) AS last_comment,
         ${OVERDUE_SQL} AS is_overdue,
         COALESCE((SELECT json_agg(json_build_object('id', i.id, 'name', i.name, 'quantity', i.quantity, 'unit', i.unit) ORDER BY i.id)
                     FROM request_items i WHERE i.request_id = r.id), '[]'::json) AS items
    FROM requests r
    JOIN users u ON u.id = r.author_id
    LEFT JOIN departments d ON d.id = u.department_id
    LEFT JOIN users a ON a.id = r.assignee_id
    JOIN categories c ON c.id = r.category_id`;

const FROM_COUNT = `FROM requests r JOIN users u ON u.id = r.author_id JOIN categories c ON c.id = r.category_id`;

const parseId = (v, msg = 'Заявка не найдена') => {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw notFound(msg);
  return id;
};
const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const link = (id) => `${config.appUrl}/requests/${id}`;

/** Условия списка (B4): сотрудник видит только свои заявки, снабжение и админ — все. */
export function buildWhere(user, f, afterId = null) {
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (user.role === 'employee') add('r.author_id = ?', user.id);
  if (f.status) add('r.status = ?', f.status);
  if (f.assignee === 'me') add('r.assignee_id = ?', user.id);
  else if (f.assignee === 'none') where.push('r.assignee_id IS NULL');
  else if (typeof f.assignee === 'number') add('r.assignee_id = ?', f.assignee);
  if (f.category) add('r.category_id = ?', f.category);
  if (f.department) add('u.department_id = ?', f.department);
  if (f.urgent) where.push('r.is_urgent');
  if (f.overdue) where.push(OVERDUE_SQL);
  if (f.from) add('r.created_at >= ?::date', f.from);
  if (f.to) add('r.created_at < ?::date + 1', f.to);
  if (afterId) add('r.id < ?', afterId);
  const words = String(f.q ?? '').trim().replace(/№/g, '').split(/\s+/).filter(Boolean).slice(0, 6);
  for (const w of words) {
    params.push(`%${likeEscape(w)}%`);
    const p = `$${params.length}`;
    where.push(`(r.id::text ILIKE ${p} OR u.full_name ILIKE ${p} OR c.name ILIKE ${p} OR r.justification ILIKE ${p}
                 OR EXISTS (SELECT 1 FROM request_items i WHERE i.request_id = r.id AND i.name ILIKE ${p}))`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

// B5: закрытые внизу, срочные и просроченные сверху, затем по дате создания
const ORDER_QUEUE = `ORDER BY (r.status IN (${CLOSED_SQL})), (r.is_urgent OR ${OVERDUE_SQL}) DESC, r.created_at DESC, r.id DESC`;
const ORDER_OWN = 'ORDER BY r.id DESC';
const parseList = (q) => listQuerySchema.parse(cleanQuery(q));

/** Заявка с лентой: комментарии, история (статусы + события) и файлы. Чужая заявка для сотрудника — 404. */
async function loadOne(db, id, user) {
  const params = [id];
  let sql = `${SELECT_REQUEST} WHERE r.id = $1`;
  if (user.role === 'employee') { params.push(user.id); sql += ' AND r.author_id = $2'; }
  const { rows } = await db.query(sql, params);
  if (!rows[0]) throw notFound('Заявка не найдена');
  const [hist, comments, files] = await Promise.all([
    db.query(`SELECT h.id, h.event, h.old_status, h.new_status, h.details, h.changed_at, u.full_name AS changed_by
                FROM status_history h JOIN users u ON u.id = h.changed_by WHERE h.request_id = $1 ORDER BY h.changed_at, h.id`, [id]),
    db.query(`SELECT c.id, c.kind, c.body, c.created_at, c.author_id, u.full_name AS author_name, u.role AS author_role
                FROM request_comments c JOIN users u ON u.id = c.author_id WHERE c.request_id = $1 ORDER BY c.created_at, c.id`, [id]),
    db.query(`SELECT f.id, f.original_name, f.mime_type, f.size_bytes, f.created_at, f.uploaded_by, u.full_name AS uploaded_by_name
                FROM request_files f JOIN users u ON u.id = f.uploaded_by WHERE f.request_id = $1 ORDER BY f.id`, [id]),
  ]);
  return { ...rows[0], history: hist.rows, comments: comments.rows, files: files.rows };
}

async function visible(db, id, user) {
  const { rows } = await db.query('SELECT id, author_id, status, assignee_id FROM requests WHERE id = $1', [id]);
  const r = rows[0];
  if (!r || (user.role === 'employee' && r.author_id !== user.id)) throw notFound('Заявка не найдена');
  return r;
}

const insertItems = (c, requestId, items) =>
  c.query(`INSERT INTO request_items (request_id, name, quantity, unit) SELECT $1, * FROM unnest($2::text[], $3::int[], $4::text[])`,
    [requestId, items.map((i) => i.name), items.map((i) => i.quantity), items.map((i) => i.unit)]);

const addEvent = (c, requestId, event, oldStatus, newStatus, userId, details = null) =>
  c.query('INSERT INTO status_history (request_id, event, old_status, new_status, changed_by, details) VALUES ($1, $2, $3, $4, $5, $6)',
    [requestId, event, oldStatus, newStatus, userId, details]);

const addComment = (c, requestId, userId, kind, body) =>
  c.query('INSERT INTO request_comments (request_id, author_id, kind, body) VALUES ($1, $2, $3, $4)', [requestId, userId, kind, body]);

const checkCategory = async (db, categoryId) => {
  const { rows } = await db.query('SELECT is_archived FROM categories WHERE id = $1', [categoryId]);
  if (!rows[0]) throw badRequest('Категория не найдена');
  if (rows[0].is_archived) throw badRequest('Эта категория в архиве, выберите другую');
};

// ---------- список (F6) ----------
router.get('/', async (req, res) => {
  const f = parseList(req.query);
  const w = buildWhere(req.user, f);
  const order = req.user.role === 'employee' ? ORDER_OWN : ORDER_QUEUE;
  const [{ rows }, cnt] = await Promise.all([
    query(`${SELECT_REQUEST} ${w.sql} ${order} LIMIT $${w.params.length + 1} OFFSET $${w.params.length + 2}`, [...w.params, f.limit, (f.page - 1) * f.limit]),
    query(`SELECT count(*)::int AS n ${FROM_COUNT} ${w.sql}`, w.params),
  ]);
  res.json({ requests: rows, total: cnt.rows[0].n, page: f.page, limit: f.limit });
});

// ---------- CSV: потоковая выгрузка всех записей (F6) ----------
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // защита от формул в Excel
  return `"${s.replace(/"/g, '""')}"`;
};

router.get('/export.csv', requireRole('buyer', 'admin'), async (req, res) => {
  const f = parseList(req.query);
  try {
    await streamCsv(req, res, f);
  } catch (e) {
    // R2: заголовки уже отправлены — обрываем соединение, чтобы файл не выглядел полным
    if (res.headersSent) { req.log?.error({ err: e }, 'csv export failed'); res.destroy(); return; }
    throw e;
  }
});

async function streamCsv(req, res, f) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="zayavki-${todayStr()}.csv"` });
  const line = (cells) => `${cells.map(csvCell).join(';')}\r\n`;
  res.write('\ufeff' + line(['№', 'Статус', 'Срочность', 'Автор', 'Подразделение', 'Категория', 'Создана', 'Нужно к', 'Сумма', 'Ответственный', 'Позиции', 'Обоснование', 'Последний комментарий']));
  const BATCH = 1000;
  let last = null;
  for (;;) {
    const w = buildWhere(req.user, f, last);
    const { rows } = await query(`${SELECT_REQUEST} ${w.sql} ORDER BY r.id DESC LIMIT ${BATCH}`, w.params);
    let chunk = '';
    for (const r of rows) {
      chunk += line([
        r.id, STATUS_RU[r.status], r.is_urgent ? 'срочная' : 'обычная', r.author_name, r.department, r.category,
        new Date(r.created_at).toISOString().slice(0, 10), r.due_date ?? '', r.budget ?? '', r.assignee_name ?? '',
        r.items.map((i) => `${i.name} — ${i.quantity} ${i.unit}`).join('; '), r.justification, r.last_comment ?? '',
      ]);
    }
    // R1: если клиент отключился, ждём не только 'drain', но и 'close' — иначе обработчик зависнет
    if (chunk && !res.write(chunk) && !res.destroyed) await Promise.race([once(res, 'drain'), once(res, 'close')]);
    if (res.destroyed || rows.length < BATCH) break;
    last = rows.at(-1).id;
  }
  res.end();
}

// ---------- создание (любая роль) ----------
router.post('/', async (req, res) => {
  const data = requestSchema.parse(req.body);
  if (data.due_date && data.due_date < todayStr()) throw badRequest('Дата «нужно к» не может быть в прошлом');
  await checkCategory({ query }, data.category_id);
  const id = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO requests (author_id, category_id, is_urgent, due_date, budget, justification) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, data.category_id, data.is_urgent, data.due_date ?? null, data.budget ?? null, data.justification]);
    await insertItems(c, rows[0].id, data.items);
    await addEvent(c, rows[0].id, 'status', null, 'new', req.user.id);
    return rows[0].id;
  });
  if (data.is_urgent) {
    const { rows } = await query(`SELECT id FROM users WHERE role = 'buyer' AND id <> $1`, [req.user.id]);
    notifyUsers(rows.map((r) => r.id), `Срочная заявка №${id}`, `${req.user.full_name} подал(а) срочную заявку №${id}.\n${link(id)}`);
  }
  res.status(201).json(await loadOne({ query }, id, req.user));
});

router.get('/:id', async (req, res) => {
  res.json(await loadOne({ query }, parseId(req.params.id), req.user));
});

// ---------- редактирование (только автор, только «Новая»; F3, F4) ----------
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const data = requestSchema.parse(req.body);
  await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT category_id, is_urgent, due_date, budget, justification, status FROM requests WHERE id = $1 AND author_id = $2 FOR UPDATE`, [id, req.user.id]);
    const cur = rows[0];
    if (!cur) throw notFound('Заявка не найдена');
    if (cur.status !== 'new') throw conflict('Заявку можно менять только в статусе «Новая»');
    if (data.due_date && data.due_date !== cur.due_date && data.due_date < todayStr()) throw badRequest('Дата «нужно к» не может быть в прошлом');
    if (data.category_id !== cur.category_id) await checkCategory(c, data.category_id);
    const oldItems = (await c.query('SELECT name, quantity, unit FROM request_items WHERE request_id = $1 ORDER BY id', [id])).rows;
    const changed = [];
    if (data.category_id !== cur.category_id) changed.push('category_id');
    if (data.is_urgent !== cur.is_urgent) changed.push('is_urgent');
    if ((data.due_date ?? null) !== cur.due_date) changed.push('due_date');
    if ((data.budget ?? null) !== cur.budget) changed.push('budget');
    if (data.justification !== cur.justification) changed.push('justification');
    const sig = (arr) => JSON.stringify(arr.map((i) => [i.name, i.quantity, i.unit]));
    if (sig(data.items) !== sig(oldItems)) changed.push('items');
    if (!changed.length) return;
    await c.query(
      `UPDATE requests SET category_id = $2, is_urgent = $3, due_date = $4, budget = $5, justification = $6, updated_at = now() WHERE id = $1`,
      [id, data.category_id, data.is_urgent, data.due_date ?? null, data.budget ?? null, data.justification]);
    await c.query('DELETE FROM request_items WHERE request_id = $1', [id]);
    await insertItems(c, id, data.items);
    const details = { changed };
    if (changed.includes('items')) details.items_before = oldItems.map((i) => `${i.name} — ${i.quantity} ${i.unit}`);
    if (changed.includes('budget')) details.budget_before = cur.budget;
    await addEvent(c, id, 'edited', null, null, req.user.id, details);
  });
  res.json(await loadOne({ query }, id, req.user));
});

// ---------- отмена (автор, только «Новая») ----------
router.post('/:id/cancel', async (req, res) => {
  const id = parseId(req.params.id);
  await tx(async (c) => {
    const { rows } = await c.query('SELECT status FROM requests WHERE id = $1 AND author_id = $2 FOR UPDATE', [id, req.user.id]);
    if (!rows[0]) throw notFound('Заявка не найдена');
    if (rows[0].status !== 'new') throw conflict('Отменить можно только заявку в статусе «Новая»');
    await c.query(`UPDATE requests SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
    await addEvent(c, id, 'status', 'new', 'cancelled', req.user.id);
  });
  res.json(await loadOne({ query }, id, req.user));
});

// ---------- ответственный (B1) ----------
router.post('/:id/assign', requireRole('buyer', 'admin'), async (req, res) => {
  const id = parseId(req.params.id);
  const { assignee_id } = assignSchema.parse(req.body ?? {});
  const isAdmin = req.user.role === 'admin';
  const target = assignee_id === undefined ? req.user.id : assignee_id; // без тела — «Взять в работу»
  if (target !== req.user.id && !isAdmin) throw forbidden('Назначить другого ответственного может только администратор');
  if (target === null && !isAdmin) throw forbidden('Снять ответственного может только администратор');
  let assigneeName = null;
  await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT r.status, r.assignee_id, r.author_id, a.full_name AS assignee_name FROM requests r LEFT JOIN users a ON a.id = r.assignee_id WHERE r.id = $1 FOR UPDATE OF r`, [id]);
    const cur = rows[0];
    if (!cur) throw notFound('Заявка не найдена');
    if (isClosed(cur.status)) throw conflict('Заявка закрыта');
    if (cur.author_id === req.user.id && !isAdmin) throw forbidden(SELF_MSG);
    if (!isAdmin && cur.assignee_id && cur.assignee_id !== req.user.id) throw forbidden(`Заявку ведёт ${cur.assignee_name}`);
    if (target !== null) {
      const t = (await c.query(`SELECT full_name FROM users WHERE id = $1 AND is_active AND role IN ('buyer', 'admin')`, [target])).rows[0];
      if (!t) throw badRequest('Ответственным можно назначить только сотрудника снабжения');
      assigneeName = t.full_name;
    }
    if (cur.assignee_id === target) return;
    await c.query('UPDATE requests SET assignee_id = $2, updated_at = now() WHERE id = $1', [id, target]);
    await addEvent(c, id, 'assigned', null, null, req.user.id, { assignee_id: target, assignee_name: assigneeName, previous_name: cur.assignee_name });
  });
  if (target && target !== req.user.id) {
    notifyUsers([target], `Вам назначена заявка №${id}`, `${req.user.full_name} назначил(а) вас ответственным за заявку №${id}.\n${link(id)}`);
  }
  res.json(await loadOne({ query }, id, req.user));
});

// ---------- смена статуса (B2, B3, F2, F3) ----------
router.patch('/:id/status', requireRole('buyer', 'admin'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = statusPatchSchema.parse(req.body);
  let authorId;
  await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT r.status, r.assignee_id, r.author_id, a.full_name AS assignee_name FROM requests r LEFT JOIN users a ON a.id = r.assignee_id WHERE r.id = $1 FOR UPDATE OF r`, [id]);
    const cur = rows[0];
    if (!cur) throw notFound('Заявка не найдена');
    authorId = cur.author_id;
    if (isClosed(cur.status)) throw conflict('Заявка закрыта — менять статус нельзя');
    if (cur.author_id === req.user.id && req.user.role !== 'admin') throw forbidden(SELF_MSG);
    if (req.user.role !== 'admin' && cur.assignee_id && cur.assignee_id !== req.user.id) throw forbidden(`Заявку ведёт ${cur.assignee_name}`);
    if (!canMove(cur.status, data.status)) throw conflict(`Переход «${STATUS_RU[cur.status]} → ${STATUS_RU[data.status]}» недопустим`);
    const autoAssign = cur.status === 'new' && data.status === 'review' && !cur.assignee_id;
    await c.query('UPDATE requests SET status = $2, assignee_id = $3, updated_at = now() WHERE id = $1',
      [id, data.status, autoAssign ? req.user.id : cur.assignee_id]);
    if (autoAssign) {
      await addEvent(c, id, 'assigned', null, null, req.user.id, { assignee_id: req.user.id, assignee_name: req.user.full_name, previous_name: null, auto: true });
    }
    await addEvent(c, id, 'status', cur.status, data.status, req.user.id);
    if (data.comment) await addComment(c, id, req.user.id, data.status === 'rejected' ? 'rejection' : 'comment', data.comment);
  });
  if (authorId !== req.user.id) {
    notifyUsers([authorId], `Заявка №${id}: ${STATUS_RU[data.status]}`,
      `Статус вашей заявки №${id} изменён на «${STATUS_RU[data.status]}».${data.comment ? `\nКомментарий: ${data.comment}` : ''}\n${link(id)}`);
  }
  res.json(await loadOne({ query }, id, req.user));
});

// ---------- комментарии (C1–C4): только добавление; к закрытым заявкам тоже можно (F3) ----------
router.get('/:id/comments', async (req, res) => {
  const id = parseId(req.params.id);
  await visible({ query }, id, req.user);
  res.json({ comments: (await loadOne({ query }, id, req.user)).comments });
});

router.post('/:id/comments', async (req, res) => {
  const id = parseId(req.params.id);
  const { body } = commentSchema.parse(req.body);
  const r = await visible({ query }, id, req.user);
  await addComment({ query }, id, req.user.id, 'comment', body);
  // BUG-025: автор пишет ответственному, а без ответственного — всем снабженцам; снабжение пишет автору и ответственному
  let to;
  if (r.author_id === req.user.id) {
    to = r.assignee_id ? [r.assignee_id] : (await query(`SELECT id FROM users WHERE role = 'buyer' AND is_active`)).rows.map((u) => u.id);
  } else to = [r.author_id, r.assignee_id];
  to = to.filter((u) => u && u !== req.user.id);
  if (to.length) notifyUsers(to, `Новый комментарий к заявке №${id}`, `${req.user.full_name}: ${body}\n${link(id)}`);
  res.status(201).json({ comments: (await loadOne({ query }, id, req.user)).comments });
});

// ---------- файлы (D1–D4) ----------
// Доступ проверяется ДО чтения тела, чтобы посторонние не заставляли сервер принимать 10 МБ.
const guardUpload = async (req, res, next) => {
  const r = await visible({ query }, parseId(req.params.id), req.user);
  if (isClosed(r.status)) throw conflict('Заявка закрыта — файлы добавлять нельзя');
  next();
};
const fileBody = raw({ type: () => true, limit: MAX_FILE_BYTES });

router.post('/:id/files', guardUpload, fileBody, async (req, res) => {
  const id = parseId(req.params.id);
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) throw badRequest('Файл пустой или не передан');
  let name = req.headers['x-file-name'] ?? '';
  try { name = decodeURIComponent(String(name)); } catch { /* оставляем как есть */ }
  name = cleanFileName(name);
  const type = detectType(buf);
  if (!type) throw badRequest('Недопустимый тип файла. Разрешены: pdf, jpg, png, webp, xlsx, docx');
  if (!extensionMatches(name, type)) throw badRequest('Расширение файла не соответствует его содержимому');

  await fsp.mkdir(config.uploadDir, { recursive: true });
  const stored = crypto.randomBytes(16).toString('hex'); // случайное имя без расширения
  const full = path.join(config.uploadDir, stored);
  await fsp.writeFile(full, buf, { mode: 0o600 });
  try {
    await tx(async (c) => {
      const { rows } = await c.query('SELECT status FROM requests WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) throw notFound('Заявка не найдена');
      if (isClosed(rows[0].status)) throw conflict('Заявка закрыта — файлы добавлять нельзя');
      const n = (await c.query('SELECT count(*)::int AS n FROM request_files WHERE request_id = $1', [id])).rows[0].n;
      if (n >= MAX_FILES_PER_REQUEST) throw conflict(`К заявке можно прикрепить не более ${MAX_FILES_PER_REQUEST} файлов`);
      await c.query(
        `INSERT INTO request_files (request_id, uploaded_by, stored_name, original_name, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, req.user.id, stored, name, MIME[type], buf.length]);
    });
  } catch (e) {
    await fsp.rm(full, { force: true });
    throw e;
  }
  res.status(201).json({ files: (await loadOne({ query }, id, req.user)).files });
});

const loadFile = async (req) => {
  const id = parseId(req.params.id);
  await visible({ query }, id, req.user);
  const { rows } = await query('SELECT * FROM request_files WHERE id = $1 AND request_id = $2', [parseId(req.params.fileId, 'Файл не найден'), id]);
  if (!rows[0]) throw notFound('Файл не найден');
  return rows[0];
};

router.get('/:id/files/:fileId', async (req, res) => {
  const f = await loadFile(req);
  const full = path.join(config.uploadDir, f.stored_name);
  let stat;
  try { stat = await fsp.stat(full); } catch { throw notFound('Файл не найден на сервере'); }
  res.set({
    'Content-Type': f.mime_type, 'Content-Length': String(stat.size),
    'Content-Disposition': contentDisposition(f.original_name), 'Cache-Control': 'private, no-store',
  });
  fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
});

router.delete('/:id/files/:fileId', async (req, res) => {
  const f = await loadFile(req);
  if (f.uploaded_by !== req.user.id) throw forbidden('Удалить файл может только его автор');
  const { rows } = await query('SELECT status FROM requests WHERE id = $1', [f.request_id]);
  if (isClosed(rows[0].status)) throw conflict('Заявка закрыта — файл удалить нельзя');
  await query('DELETE FROM request_files WHERE id = $1', [f.id]);
  await fsp.rm(path.join(config.uploadDir, f.stored_name), { force: true });
  res.status(204).end();
});

export default router;
