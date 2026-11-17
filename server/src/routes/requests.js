import { Router } from 'express';
import { query, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { requestSchema, statusPatchSchema, todayStr } from '../schemas.js';
import { STATUSES, CLOSED, canMove } from '../statuses.js';
import { describeEdit } from '../history.js';

const LIST_LIMIT = 500;
const INT4_MAX = 2147483647;

const router = Router();

const SELECT_REQUEST = `
  SELECT r.id, r.is_urgent, r.due_date, r.budget, r.justification, r.status, r.buyer_comment,
         r.created_at, r.updated_at,
         u.id AS author_id, u.full_name AS author_name, d.name AS department,
         c.id AS category_id, c.name AS category,
         COALESCE((SELECT json_agg(json_build_object('id', i.id, 'name', i.name,
                                                      'quantity', i.quantity, 'unit', i.unit) ORDER BY i.id)
                     FROM request_items i WHERE i.request_id = r.id), '[]'::json) AS items
    FROM requests r
    JOIN users u ON u.id = r.author_id
    LEFT JOIN departments d ON d.id = u.department_id
    JOIN categories c ON c.id = r.category_id`;

const parseId = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1 || id > INT4_MAX) throw notFound('Заявка не найдена');
  return id;
};

const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Условия списка: сотрудник видит только свои заявки, снабжение и админ — все. */
/** limit = null — без ограничения (для CSV). */
export function buildListQuery(user, { status, q }, { limit = LIST_LIMIT } = {}) {
  const where = [];
  const params = [];
  if (user.role === 'employee') {
    params.push(user.id);
    where.push(`r.author_id = $${params.length}`);
  }
  if (status) {
    if (!STATUSES.includes(status)) throw badRequest('Неизвестный статус');
    params.push(status);
    where.push(`r.status = $${params.length}`);
  }
  const words = String(q ?? '').trim().replace(/№/g, '').split(/\s+/).filter(Boolean).slice(0, 6);
  for (const w of words) {
    params.push(`%${likeEscape(w)}%`);
    const p = `$${params.length}`;
    where.push(`(r.id::text ILIKE ${p} OR u.full_name ILIKE ${p} OR c.name ILIKE ${p}
                 OR r.justification ILIKE ${p}
                 OR EXISTS (SELECT 1 FROM request_items i WHERE i.request_id = r.id AND i.name ILIKE ${p}))`);
  }
  const order =
    user.role === 'employee'
      ? 'ORDER BY r.id DESC'
      : `ORDER BY (r.status IN ('done', 'rejected', 'cancelled')), r.is_urgent DESC, r.id DESC`;
  const sql = `${SELECT_REQUEST} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${order}${limit ? ` LIMIT ${Number(limit)}` : ''}`;
  return { sql, params };
}

async function loadOne(db, id, user) {
  const params = [id];
  let sql = `${SELECT_REQUEST} WHERE r.id = $1`;
  if (user.role === 'employee') {
    params.push(user.id);
    sql += ' AND r.author_id = $2'; // чужая заявка для сотрудника — 404
  }
  const { rows } = await db.query(sql, params);
  if (!rows[0]) throw notFound('Заявка не найдена');
  const hist = await db.query(
    `SELECT h.id, h.old_status, h.new_status, h.kind, h.comment, h.changed_at, u.full_name AS changed_by
       FROM status_history h JOIN users u ON u.id = h.changed_by
      WHERE h.request_id = $1 ORDER BY h.changed_at, h.id`,
    [id],
  );
  return { ...rows[0], history: hist.rows };
}

const insertItems = (c, requestId, items) =>
  c.query(
    `INSERT INTO request_items (request_id, name, quantity, unit)
     SELECT $1, * FROM unnest($2::text[], $3::int[], $4::text[])`,
    [requestId, items.map((i) => i.name), items.map((i) => i.quantity), items.map((i) => i.unit)],
  );

/** kind: 'status' — смена статуса, 'comment' — комментарий снабжения, 'edit' — правка заявки автором. */
const addHistory = (c, requestId, oldStatus, newStatus, userId, { kind = 'status', comment = null } = {}) =>
  c.query(
    `INSERT INTO status_history (request_id, old_status, new_status, changed_by, kind, comment)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [requestId, oldStatus, newStatus, userId, kind, comment],
  );

// ---------- список ----------
router.get('/', async (req, res) => {
  // запрашиваем на одну запись больше, чтобы понять, что список обрезан
  const { sql, params } = buildListQuery(req.user, req.query, { limit: LIST_LIMIT + 1 });
  const { rows } = await query(sql, params);
  const truncated = rows.length > LIST_LIMIT;
  res.json({ requests: truncated ? rows.slice(0, LIST_LIMIT) : rows, truncated, limit: LIST_LIMIT });
});

// ---------- CSV (до /:id, чтобы не конфликтовать) ----------
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // защита от формул в Excel
  return `"${s.replace(/"/g, '""')}"`;
};
const STATUS_RU = { new: 'Новая', review: 'На согласовании', buying: 'В закупке', done: 'Выполнена', rejected: 'Отклонена', cancelled: 'Отменена' };

router.get('/export.csv', requireRole('buyer', 'admin'), async (req, res) => {
  const { sql, params } = buildListQuery(req.user, req.query, { limit: null });
  const { rows } = await query(sql, params);
  const head = ['№', 'Статус', 'Срочность', 'Автор', 'Подразделение', 'Категория', 'Создана', 'Нужно к', 'Сумма', 'Позиции', 'Обоснование', 'Комментарий'];
  const lines = rows.map((r) => [
    r.id, STATUS_RU[r.status], r.is_urgent ? 'срочная' : 'обычная', r.author_name, r.department, r.category,
    new Date(r.created_at).toISOString().slice(0, 10), r.due_date ?? '', r.budget ?? '',
    r.items.map((i) => `${i.name} — ${i.quantity} ${i.unit}`).join('; '), r.justification, r.buyer_comment,
  ]);
  const csv = '﻿' + [head, ...lines].map((l) => l.map(csvCell).join(';')).join('\r\n');
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="zayavki-${todayStr()}.csv"`,
  });
  res.send(csv);
});

// ---------- создание ----------
router.post('/', requireRole('employee'), async (req, res) => {
  const data = requestSchema.parse(req.body);
  if (data.due_date && data.due_date < todayStr()) throw badRequest('Дата «нужно к» не может быть в прошлом');
  const id = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO requests (author_id, category_id, is_urgent, due_date, budget, justification)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, data.category_id, data.is_urgent, data.due_date ?? null, data.budget ?? null, data.justification],
    );
    await insertItems(c, rows[0].id, data.items);
    await addHistory(c, rows[0].id, null, 'new', req.user.id);
    return rows[0].id;
  });
  res.status(201).json(await loadOne({ query }, id, req.user));
});

// ---------- одна заявка ----------
router.get('/:id', async (req, res) => {
  res.json(await loadOne({ query }, parseId(req.params.id), req.user));
});

// ---------- редактирование (владелец, только new) ----------
router.put('/:id', requireRole('employee'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = requestSchema.parse(req.body);
  await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT status, due_date, category_id, is_urgent, budget, justification
         FROM requests WHERE id = $1 AND author_id = $2 FOR UPDATE`,
      [id, req.user.id],
    );
    if (!rows[0]) throw notFound('Заявка не найдена');
    if (rows[0].status !== 'new') throw conflict('Заявку можно менять только в статусе «Новая»');
    if (data.due_date && data.due_date !== rows[0].due_date && data.due_date < todayStr()) {
      throw badRequest('Дата «нужно к» не может быть в прошлом');
    }
    await c.query(
      `UPDATE requests SET category_id = $2, is_urgent = $3, due_date = $4, budget = $5,
                           justification = $6, updated_at = now()
        WHERE id = $1`,
      [id, data.category_id, data.is_urgent, data.due_date ?? null, data.budget ?? null, data.justification],
    );
    const { rows: oldItems } = await c.query(
      'SELECT name, quantity, unit FROM request_items WHERE request_id = $1 ORDER BY id',
      [id],
    );
    await c.query('DELETE FROM request_items WHERE request_id = $1', [id]);
    await insertItems(c, id, data.items);
    // правка попадает в историю, чтобы снабжение видело, что заявка изменилась после просмотра
    const changes = describeEdit({ ...rows[0], items: oldItems }, { ...data, items: data.items });
    if (changes) await addHistory(c, id, 'new', 'new', req.user.id, { kind: 'edit', comment: changes });
  });
  res.json(await loadOne({ query }, id, req.user));
});

// ---------- отмена (владелец, только new) ----------
router.post('/:id/cancel', requireRole('employee'), async (req, res) => {
  const id = parseId(req.params.id);
  await tx(async (c) => {
    const { rows } = await c.query(
      'SELECT status FROM requests WHERE id = $1 AND author_id = $2 FOR UPDATE',
      [id, req.user.id],
    );
    if (!rows[0]) throw notFound('Заявка не найдена');
    if (rows[0].status !== 'new') throw conflict('Отменить можно только заявку в статусе «Новая»');
    await c.query(`UPDATE requests SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
    await addHistory(c, id, 'new', 'cancelled', req.user.id);
  });
  res.json(await loadOne({ query }, id, req.user));
});

// ---------- смена статуса и/или комментарий (buyer, admin) ----------
router.patch('/:id/status', requireRole('buyer', 'admin'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = statusPatchSchema.parse(req.body);
  await tx(async (c) => {
    const { rows } = await c.query('SELECT status, buyer_comment FROM requests WHERE id = $1 FOR UPDATE', [id]);
    const cur = rows[0];
    if (!cur) throw notFound('Заявка не найдена');
    const incoming = data.comment; // уже обрезан по краям (zod)
    if (!data.status) {
      // комментарий в закрытой заявке менять нельзя: иначе причину отказа можно переписать задним числом
      if (CLOSED.includes(cur.status)) throw conflict('Заявка закрыта — комментарий изменить нельзя');
      if (incoming === cur.buyer_comment) return; // ничего не изменилось
    } else {
      if (!canMove(cur.status, data.status)) {
        throw conflict(`Переход «${cur.status} → ${data.status}» недопустим`);
      }
      // причина отклонения должна прийти в этом же запросе, а не «по старому» комментарию
      if (data.status === 'rejected' && !incoming) {
        throw badRequest('При отклонении укажите причину в комментарии');
      }
    }
    const comment = incoming ?? cur.buyer_comment;
    await c.query(
      'UPDATE requests SET status = $2, buyer_comment = $3, updated_at = now() WHERE id = $1',
      [id, data.status ?? cur.status, comment],
    );
    if (data.status) {
      // комментарий фиксируем в истории при отклонении и когда он изменился вместе со статусом
      const note = data.status === 'rejected' || incoming !== cur.buyer_comment ? incoming || null : null;
      await addHistory(c, id, cur.status, data.status, req.user.id, { comment: note });
    } else {
      await addHistory(c, id, cur.status, cur.status, req.user.id, { kind: 'comment', comment });
    }
  });
  res.json(await loadOne({ query }, id, req.user));
});

export default router;
