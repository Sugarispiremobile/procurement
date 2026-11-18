// Интеграционные тесты API (node:test + встроенный fetch) на отдельной тестовой базе.
// Запуск:  TEST_DATABASE_URL=postgres://procurement:procurement@localhost:5432/procurement_test npm test
// ВНИМАНИЕ: схема тестовой базы очищается при запуске (DROP SCHEMA public CASCADE) — используйте отдельную базу.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'не задан TEST_DATABASE_URL';

describe('API', { skip }, () => {
  let server, server2, base, base2, pool, hash, todayStr, outbox, uploadDir;
  const tokens = {};
  const ids = {};

  const call = async (b, method, url, { token, body, headers = {}, raw } = {}) => {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(b + url, { method, headers: h, body: payload });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* не JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const api = (...a) => call(base, ...a);

  const mkUser = async (key, role, { dept = null } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, department_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`User ${key}`, `${key}@corp.kz`, hash('password1'), role, dept]);
    ids[key] = rows[0].id;
    const r = await api('POST', '/api/auth/login', { body: { email: `${key}@corp.kz`, password: 'password1' } });
    if (r.status === 200) tokens[key] = r.json.token;
  };

  const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const goodReq = (extra = {}) => ({ category_id: ids.cat, justification: 'Нужно для работы', items: [{ name: 'Бумага', quantity: 2 }], ...extra });
  const newReq = async (who = 'emp', extra = {}) => {
    const r = await api('POST', '/api/requests', { token: tokens[who], body: goodReq(extra) });
    assert.equal(r.status, 201, r.text);
    return r.json.id;
  };
  const upload = (id, who, name, buf) =>
    api('POST', `/api/requests/${id}/files`, { token: tokens[who], raw: buf, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) } });
  const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)]);
  const waitMail = async (pred) => {
    for (let i = 0; i < 40; i++) { const m = outbox.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 25)); }
    return null;
  };

  before(async () => {
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'procurement-test-'));
    Object.assign(process.env, {
      DATABASE_URL: TEST_DB, JWT_SECRET: 'test-secret-test-secret-test-secret-123', NODE_ENV: 'test',
      ALLOWED_EMAIL_DOMAIN: 'corp.kz', UPLOAD_DIR: uploadDir, APP_URL: 'http://app.test', SMTP_HOST: '',
    });
    delete process.env.TRUST_PROXY;
    ({ pool } = await import('../src/db.js'));
    const { createApp } = await import('../src/app.js');
    const { migrate } = await import('../scripts/migrate.js');
    ({ todayStr } = await import('../src/dates.js'));
    ({ outbox } = await import('../src/mailer.js'));
    const bcrypt = (await import('bcryptjs')).default;
    hash = (p) => bcrypt.hashSync(p, 4);

    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool, () => {});
    server = createApp().listen(0);
    server2 = createApp().listen(0); // отдельные счётчики лимитов для тестов частоты
    base = `http://127.0.0.1:${server.address().port}`;
    base2 = `http://127.0.0.1:${server2.address().port}`;

    ids.dept = (await pool.query(`INSERT INTO departments (name) VALUES ('ИТ'), ('Склад') RETURNING id`)).rows[0].id;
    ids.cat = (await pool.query(`INSERT INTO categories (name) VALUES ('Канцелярия') RETURNING id`)).rows[0].id;
    await mkUser('emp', 'employee', { dept: ids.dept });
    await mkUser('emp2', 'employee');
    await mkUser('buyer', 'buyer');
    await mkUser('buyer2', 'buyer');
    await mkUser('admin', 'admin');
  });

  after(async () => {
    server?.close(); server2?.close();
    await pool?.end();
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  describe('миграция и окружение', () => {
    it('часовой пояс сессии БД — APP_TZ (F5)', async () => {
      assert.equal((await pool.query('SHOW TimeZone')).rows[0].TimeZone, 'Asia/Almaty');
    });
    it('/api/config отдаёт валюту и признак регистрации', async () => {
      const r = await api('GET', '/api/config');
      assert.equal(r.json.currency, '₸');
      assert.equal(r.json.registrationOpen, true);
    });
    it('заголовки безопасности и CSP (A9)', async () => {
      const r = await api('GET', '/api/health');
      assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    });
  });

  describe('заявки: исправления F1–F6', () => {
    it('1. due_date 2026-02-31 → 400 «Такой даты нет»', async () => {
      const r = await api('POST', '/api/requests', { token: tokens.emp, body: goodReq({ due_date: '2026-02-31' }) });
      assert.equal(r.status, 400);
      assert.match(r.json.error, /Такой даты нет/);
    });
    it('дата в прошлом (в APP_TZ) → 400', async () => {
      const r = await api('POST', '/api/requests', { token: tokens.emp, body: goodReq({ due_date: addDays(todayStr(), -1) }) });
      assert.equal(r.status, 400);
    });
    it('мусор в параметрах списка → 400, а не 500', async () => {
      assert.equal((await api('GET', '/api/requests?page=abc', { token: tokens.emp })).status, 400);
      assert.equal((await api('GET', '/api/requests?from=2026-02-31', { token: tokens.buyer })).status, 400);
      assert.equal((await api('GET', '/api/requests/abc', { token: tokens.emp })).status, 404);
    });
    it('2. отклонение без комментария в том же запросе → 400, даже если комментарии были', async () => {
      const id = await newReq();
      await api('POST', `/api/requests/${id}/comments`, { token: tokens.buyer, body: { body: 'Уточните модель' } });
      assert.equal((await api('PATCH', `/api/requests/${id}/status`, { token: tokens.buyer, body: { status: 'rejected' } })).status, 400);
      const ok = await api('PATCH', `/api/requests/${id}/status`, { token: tokens.buyer, body: { status: 'rejected', comment: 'Нет бюджета' } });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.status, 'rejected');
      assert.equal(ok.json.comments.find((c) => c.kind === 'rejection').body, 'Нет бюджета');
    });
    it('F3: закрытую заявку нельзя редактировать и менять; комментировать можно', async () => {
      const id = await newReq();
      await api('POST', `/api/requests/${id}/cancel`, { token: tokens.emp });
      assert.equal((await api('PUT', `/api/requests/${id}`, { token: tokens.emp, body: goodReq() })).status, 409);
      assert.equal((await api('PATCH', `/api/requests/${id}/status`, { token: tokens.buyer, body: { status: 'review' } })).status, 409);
      assert.equal((await api('POST', `/api/requests/${id}/comments`, { token: tokens.buyer, body: { body: 'Принято к сведению' } })).status, 201);
    });
    it('цепочка статусов: пропуск этапа → 409', async () => {
      const id = await newReq();
      assert.equal((await api('PATCH', `/api/requests/${id}/status`, { token: tokens.buyer, body: { status: 'done' } })).status, 409);
    });
    it('4. правка владельцем попадает в историю (F4); без изменений — не пишется', async () => {
      const id = await newReq();
      const same = await api('PUT', `/api/requests/${id}`, { token: tokens.emp, body: goodReq() });
      assert.equal(same.json.history.filter((h) => h.event === 'edited').length, 0);
      const r = await api('PUT', `/api/requests/${id}`, { token: tokens.emp, body: goodReq({ items: [{ name: 'Бумага', quantity: 5 }], budget: 1000 }) });
      assert.equal(r.status, 200);
      const ev = r.json.history.find((h) => h.event === 'edited');
      assert.deepEqual(ev.details.changed.sort(), ['budget', 'items']);
      assert.deepEqual(ev.details.items_before, ['Бумага — 2 шт.']);
    });
    it('любая роль может подать заявку', async () => {
      for (const who of ['buyer', 'admin']) assert.equal((await api('POST', '/api/requests', { token: tokens[who], body: goodReq() })).status, 201);
    });
    it('чужую заявку сотрудник не видит (404)', async () => {
      const id = await newReq();
      assert.equal((await api('GET', `/api/requests/${id}`, { token: tokens.emp2 })).status, 404);
      assert.equal((await api('GET', `/api/requests/${id}/comments`, { token: tokens.emp2 })).status, 404);
      assert.equal((await api('PUT', `/api/requests/${id}`, { token: tokens.emp2, body: goodReq() })).status, 404);
    });
    it('сотрудник не может менять статус (403)', async () => {
      const id = await newReq();
      assert.equal((await api('PATCH', `/api/requests/${id}/status`, { token: tokens.emp, body: { status: 'review' } })).status, 403);
    });
  });

  describe('ответственный (B1–B3)', () => {
    it('B2: new → review автоматически назначает выполнившего; в истории есть событие', async () => {
      const id = await newReq();
      const r = await api('PATCH', `/api/requests/${id}/status`, { token: tokens.buyer, body: { status: 'review' } });
      assert.equal(r.json.assignee_id, ids.buyer);
      assert.ok(r.json.history.some((h) => h.event === 'assigned' && h.details.auto));
    });
    it('7. B3: другой снабженец не может сменить статус → 403 «Заявку ведёт …»', async () => {
      const id = await newReq();
      await api('PATCH', `/api/requests/${id}/status`, { token: tokens.buyer, body: { status: 'review' } });
      const r = await api('PATCH', `/api/requests/${id}/status`, { token: tokens.buyer2, body: { status: 'buying' } });
      assert.equal(r.status, 403);
      assert.match(r.json.error, /Заявку ведёт User buyer/);
      assert.equal((await api('PATCH', `/api/requests/${id}/status`, { token: tokens.admin, body: { status: 'buying' } })).status, 200);
    });
    it('B1: «Взять в работу»; чужую забрать нельзя, админ назначает любого снабженца', async () => {
      const id = await newReq();
      assert.equal((await api('POST', `/api/requests/${id}/assign`, { token: tokens.buyer })).json.assignee_id, ids.buyer);
      assert.equal((await api('POST', `/api/requests/${id}/assign`, { token: tokens.buyer2 })).status, 403);
      const r = await api('POST', `/api/requests/${id}/assign`, { token: tokens.admin, body: { assignee_id: ids.buyer2 } });
      assert.equal(r.json.assignee_id, ids.buyer2);
      assert.equal(r.json.history.filter((h) => h.event === 'assigned').length, 2);
      assert.equal((await api('POST', `/api/requests/${id}/assign`, { token: tokens.admin, body: { assignee_id: ids.emp } })).status, 400);
      assert.equal((await api('POST', `/api/requests/${id}/assign`, { token: tokens.emp })).status, 403);
    });
    it('назначение уведомляет назначенного', async () => {
      const id = await newReq();
      await api('POST', `/api/requests/${id}/assign`, { token: tokens.admin, body: { assignee_id: ids.buyer2 } });
      assert.ok(await waitMail((m) => m.to === 'buyer2@corp.kz' && m.subject.includes(`№${id}`)));
    });
  });

  describe('комментарии (C1–C5)', () => {
    it('3. комментарии только добавляются; изменить/удалить через API нельзя', async () => {
      const id = await newReq();
      assert.equal((await api('POST', `/api/requests/${id}/comments`, { token: tokens.buyer, body: { body: 'Первый' } })).status, 201);
      await api('POST', `/api/requests/${id}/comments`, { token: tokens.emp, body: { body: 'Второй' } });
      const list = await api('GET', `/api/requests/${id}/comments`, { token: tokens.emp });
      assert.deepEqual(list.json.comments.map((c) => c.body), ['Первый', 'Второй']);
      const cid = list.json.comments[0].id;
      for (const m of ['PUT', 'PATCH', 'DELETE']) {
        assert.ok([404, 405].includes((await api(m, `/api/requests/${id}/comments/${cid}`, { token: tokens.buyer, body: { body: 'x' } })).status));
      }
    });
    it('на уровне БД комментарий нельзя изменить или удалить', async () => {
      await assert.rejects(pool.query(`UPDATE request_comments SET body = 'x'`), /нельзя изменять/);
      await assert.rejects(pool.query('DELETE FROM request_comments'), /нельзя изменять/);
    });
    it('C4: длина 1–1000; HTML сохраняется как текст', async () => {
      const id = await newReq();
      assert.equal((await api('POST', `/api/requests/${id}/comments`, { token: tokens.emp, body: { body: '  ' } })).status, 400);
      assert.equal((await api('POST', `/api/requests/${id}/comments`, { token: tokens.emp, body: { body: 'x'.repeat(1001) } })).status, 400);
      const r = await api('POST', `/api/requests/${id}/comments`, { token: tokens.emp, body: { body: '<b>hi</b>' } });
      assert.equal(r.json.comments[0].body, '<b>hi</b>');
    });
    it('чужой сотрудник не может комментировать (404)', async () => {
      const id = await newReq();
      assert.equal((await api('POST', `/api/requests/${id}/comments`, { token: tokens.emp2, body: { body: 'привет' } })).status, 404);
    });
    it('C5: столбец buyer_comment удалён', async () => {
      const { rows } = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'requests' AND column_name = 'buyer_comment'`);
      assert.equal(rows.length, 0);
    });
  });

  describe('доступ и учётные записи (A1–A9)', () => {
    it('5. регистрация вне ALLOWED_EMAIL_DOMAIN → 403', async () => {
      const r = await api('POST', '/api/auth/register', { body: { full_name: 'Чужой', email: 'x@gmail.com', password: 'password1' } });
      assert.equal(r.status, 403);
    });
    it('регистрация с корпоративным адресом разрешена; роль всегда employee', async () => {
      const r = await api('POST', '/api/auth/register', { body: { full_name: 'Новый Сотрудник', email: 'new@corp.kz', password: 'password1', role: 'admin' } });
      assert.equal(r.status, 201);
      assert.equal(r.json.user.role, 'employee');
    });
    it('A1: пока домен не задан, регистрация отключена', async () => {
      const { config } = await import('../src/config.js');
      const saved = config.allowedEmailDomain;
      config.allowedEmailDomain = '';
      try {
        assert.equal((await api('POST', '/api/auth/register', { body: { full_name: 'Кто-то', email: 'a@corp.kz', password: 'password1' } })).status, 403);
      } finally { config.allowedEmailDomain = saved; }
    });
    it('6. после блокировки — 401 на следующем же запросе, вход невозможен; сам себя админ не блокирует', async () => {
      await mkUser('victim', 'employee');
      assert.equal((await api('GET', '/api/requests', { token: tokens.victim })).status, 200);
      assert.equal((await api('PATCH', `/api/users/${ids.admin}`, { token: tokens.admin, body: { is_active: false } })).status, 409);
      assert.equal((await api('PATCH', `/api/users/${ids.victim}`, { token: tokens.admin, body: { is_active: false } })).status, 200);
      assert.equal((await api('GET', '/api/requests', { token: tokens.victim })).status, 401);
      assert.equal((await api('POST', '/api/auth/login', { body: { email: 'victim@corp.kz', password: 'password1' } })).status, 401);
      await api('PATCH', `/api/users/${ids.victim}`, { token: tokens.admin, body: { is_active: true } });
      assert.equal((await api('GET', '/api/requests', { token: tokens.victim })).status, 401); // старый токен не оживает
      assert.equal((await api('POST', '/api/auth/login', { body: { email: 'victim@corp.kz', password: 'password1' } })).status, 200);
    });
    it('админ не снимает роль админа с себя; управление пользователями — только админ', async () => {
      assert.equal((await api('PATCH', `/api/users/${ids.admin}`, { token: tokens.admin, body: { role: 'buyer' } })).status, 409);
      assert.equal((await api('GET', '/api/users', { token: tokens.buyer })).status, 403);
      assert.equal((await api('PATCH', `/api/users/${ids.emp}`, { token: tokens.emp, body: { role: 'admin' } })).status, 403);
    });
    it('A2: приглашение — создание, письмо, принятие, повторное использование невозможно', async () => {
      const c = await api('POST', '/api/users', { token: tokens.admin, body: { full_name: 'Пётр Приглашённый', email: 'Peter@corp.kz', role: 'buyer', department_id: ids.dept } });
      assert.equal(c.status, 201);
      assert.equal(c.json.user.pending_invite, true);
      const token = c.json.invite_url.split('/invite/')[1];
      assert.ok(await waitMail((m) => m.to === 'peter@corp.kz' && m.text.includes(token)));
      assert.equal((await api('POST', '/api/auth/login', { body: { email: 'peter@corp.kz', password: 'password1' } })).status, 401);
      assert.equal((await api('GET', `/api/auth/invite/${token}`)).json.email, 'peter@corp.kz');
      assert.equal((await api('POST', '/api/auth/accept-invite', { body: { token, password: '1234567' } })).status, 400);
      const ok = await api('POST', '/api/auth/accept-invite', { body: { token, password: 'newpassword1' } });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.user.role, 'buyer');
      assert.equal((await api('POST', '/api/auth/accept-invite', { body: { token, password: 'newpassword2' } })).status, 404);
      assert.equal((await api('POST', '/api/auth/login', { body: { email: 'peter@corp.kz', password: 'newpassword1' } })).status, 200);
      assert.equal((await api('POST', '/api/users', { token: tokens.admin, body: { full_name: 'Дубль', email: 'peter@corp.kz' } })).status, 409);
    });
    it('A2: просроченное приглашение не принимается (72 ч)', async () => {
      const c = await api('POST', '/api/users', { token: tokens.admin, body: { full_name: 'Опоздавший', email: 'late@corp.kz' } });
      await pool.query(`UPDATE invites SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL`);
      const token = c.json.invite_url.split('/invite/')[1];
      assert.equal((await api('POST', '/api/auth/accept-invite', { body: { token, password: 'password123' } })).status, 404);
    });
    it('A5: сброс пароля — старый пароль перестаёт работать, приходит новая ссылка', async () => {
      await mkUser('forgetful', 'employee');
      const r = await api('POST', `/api/users/${ids.forgetful}/reset-password`, { token: tokens.admin });
      assert.equal(r.status, 200);
      assert.match(r.json.invite_url, /^http:\/\/app\.test\/invite\//);
      assert.equal((await api('GET', '/api/requests', { token: tokens.forgetful })).status, 401);
      assert.equal((await api('POST', '/api/auth/login', { body: { email: 'forgetful@corp.kz', password: 'password1' } })).status, 401);
      const token = r.json.invite_url.split('/invite/')[1];
      assert.equal((await api('POST', '/api/auth/accept-invite', { body: { token, password: 'brandnewpass' } })).status, 200);
      assert.equal((await api('POST', '/api/users/9999/reset-password', { token: tokens.admin })).status, 404);
    });
    it('A4: смена пароля требует текущий; старые токены гаснут, новый работает', async () => {
      await mkUser('changer', 'employee');
      assert.equal((await api('POST', '/api/auth/change-password', { token: tokens.changer, body: { current_password: 'wrongpass', new_password: 'password2' } })).status, 400);
      const r = await api('POST', '/api/auth/change-password', { token: tokens.changer, body: { current_password: 'password1', new_password: 'password2' } });
      assert.equal(r.status, 200);
      assert.equal((await api('GET', '/api/auth/me', { token: tokens.changer })).status, 401);
      assert.equal((await api('GET', '/api/auth/me', { token: r.json.token })).status, 200);
    });
    it('A6: «Выйти на всех устройствах» гасит токены', async () => {
      await mkUser('leaver', 'employee');
      assert.equal((await api('POST', '/api/auth/logout-all', { token: tokens.leaver })).status, 204);
      assert.equal((await api('GET', '/api/auth/me', { token: tokens.leaver })).status, 401);
    });
    it('профиль: галочка уведомлений; отключившему письма не приходят', async () => {
      const r = await api('PATCH', '/api/auth/me', { token: tokens.emp2, body: { notify_email: false } });
      assert.equal(r.json.user.notify_email, false);
      const id = await newReq('emp2');
      outbox.length = 0;
      await api('PATCH', `/api/requests/${id}/status`, { token: tokens.buyer, body: { status: 'review' } });
      await new Promise((r2) => setTimeout(r2, 150));
      assert.equal(outbox.filter((m) => m.to === 'emp2@corp.kz').length, 0);
      await api('PATCH', '/api/auth/me', { token: tokens.emp2, body: { notify_email: true } });
    });
    it('справочники: переименование и архивирование; архивная категория недоступна для новых заявок', async () => {
      const c = await api('POST', '/api/categories', { token: tokens.admin, body: { name: 'Мебель' } });
      assert.equal(c.status, 201);
      assert.equal((await api('POST', '/api/categories', { token: tokens.admin, body: { name: 'мебель' } })).status, 409);
      assert.equal((await api('PATCH', `/api/categories/${c.json.id}`, { token: tokens.admin, body: { name: 'Офисная мебель' } })).json.name, 'Офисная мебель');
      assert.equal((await api('PATCH', `/api/categories/${c.json.id}`, { token: tokens.emp, body: { name: 'X' } })).status, 403);
      await api('PATCH', `/api/categories/${c.json.id}`, { token: tokens.admin, body: { is_archived: true } });
      assert.ok(!(await api('GET', '/api/categories', { token: tokens.emp })).json.items.some((i) => i.id === c.json.id));
      assert.ok((await api('GET', '/api/categories/all', { token: tokens.admin })).json.items.some((i) => i.id === c.json.id));
      assert.equal((await api('GET', '/api/categories/all', { token: tokens.emp })).status, 403);
      assert.equal((await api('POST', '/api/requests', { token: tokens.emp, body: goodReq({ category_id: c.json.id }) })).status, 400);
    });
  });

  describe('вложения (D1–D4)', () => {
    it('загрузка pdf, скачивание с Content-Disposition: attachment, случайное имя на диске', async () => {
      const id = await newReq();
      const u = await upload(id, 'emp', 'Счёт №1.pdf', PDF);
      assert.equal(u.status, 201);
      assert.equal(u.json.files[0].original_name, 'Счёт №1.pdf');
      assert.equal(u.json.files[0].mime_type, 'application/pdf');
      const d = await api('GET', `/api/requests/${id}/files/${u.json.files[0].id}`, { token: tokens.buyer });
      assert.equal(d.status, 200);
      assert.match(d.headers.get('content-disposition'), /^attachment;/);
      assert.equal(d.text.length, PDF.length);
      const stored = (await pool.query('SELECT stored_name FROM request_files WHERE id = $1', [u.json.files[0].id])).rows[0].stored_name;
      assert.match(stored, /^[0-9a-f]{32}$/);
      assert.ok(fs.existsSync(path.join(uploadDir, stored)));
    });
    it('8. .exe, переименованный в .pdf, не загружается; расширение должно совпадать с содержимым', async () => {
      const id = await newReq();
      assert.equal((await upload(id, 'emp', 'virus.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]))).status, 400);
      assert.equal((await upload(id, 'emp', 'photo.png', PDF)).status, 400);
      assert.equal((await upload(id, 'emp', 'empty.pdf', Buffer.alloc(0))).status, 400);
    });
    it('8. файл > 10 МБ не загружается', async () => {
      const id = await newReq();
      const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024 + 1, 1)]);
      assert.equal((await upload(id, 'emp', 'big.pdf', big)).status, 413);
    });
    it('docx по сигнатуре принимается', async () => {
      const id = await newReq();
      const docx = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('[Content_Types].xml word/document.xml'), Buffer.alloc(64)]);
      assert.equal((await upload(id, 'emp', 'КП.docx', docx)).status, 201);
    });
    it('D1: не более 5 файлов на заявку; лишний файл с диска убирается', async () => {
      const id = await newReq();
      for (let i = 0; i < 5; i++) assert.equal((await upload(id, 'emp', `f${i}.pdf`, PDF)).status, 201);
      assert.equal((await upload(id, 'emp', 'f6.pdf', PDF)).status, 409);
      const n = fs.readdirSync(uploadDir).length;
      await upload(id, 'emp', 'f7.pdf', PDF);
      assert.equal(fs.readdirSync(uploadDir).length, n);
    });
    it('9. сотрудник не может скачать файл чужой заявки (404) и загрузить в чужую', async () => {
      const id = await newReq();
      const u = await upload(id, 'emp', 'a.pdf', PDF);
      assert.equal((await api('GET', `/api/requests/${id}/files/${u.json.files[0].id}`, { token: tokens.emp2 })).status, 404);
      assert.equal((await upload(id, 'emp2', 'b.pdf', PDF)).status, 404);
      assert.equal((await api('GET', `/api/requests/${id}/files/99999`, { token: tokens.emp })).status, 404);
    });
    it('D4: удалить может только автор файла и пока заявка не закрыта', async () => {
      const id = await newReq();
      const u = await upload(id, 'emp', 'a.pdf', PDF);
      const fid = u.json.files[0].id;
      assert.equal((await api('DELETE', `/api/requests/${id}/files/${fid}`, { token: tokens.buyer })).status, 403);
      const b = await upload(id, 'buyer', 'b.pdf', PDF);
      assert.equal((await api('DELETE', `/api/requests/${id}/files/${fid}`, { token: tokens.emp })).status, 204);
      assert.equal((await api('GET', `/api/requests/${id}/files/${fid}`, { token: tokens.emp })).status, 404);
      await api('POST', `/api/requests/${id}/cancel`, { token: tokens.emp });
      assert.equal((await api('DELETE', `/api/requests/${id}/files/${b.json.files.at(-1).id}`, { token: tokens.buyer })).status, 409);
      assert.equal((await upload(id, 'emp', 'late.pdf', PDF)).status, 409);
    });
  });

  describe('уведомления (раздел 4.6)', () => {
    it('10. смена статуса → письмо автору со ссылкой', async () => {
      const id = await newReq('emp');
      outbox.length = 0;
      await api('PATCH', `/api/requests/${id}/status`, { token: tokens.buyer, body: { status: 'review' } });
      const m = await waitMail((x) => x.to === 'emp@corp.kz' && x.subject.includes(`№${id}`));
      assert.ok(m);
      assert.match(m.text, new RegExp(`http://app.test/requests/${id}`));
    });
    it('комментарий снабжения → автору; комментарий автора → ответственному', async () => {
      const id = await newReq('emp');
      await api('POST', `/api/requests/${id}/assign`, { token: tokens.buyer });
      outbox.length = 0;
      await api('POST', `/api/requests/${id}/comments`, { token: tokens.buyer, body: { body: 'Какая модель?' } });
      assert.ok(await waitMail((x) => x.to === 'emp@corp.kz' && x.text.includes('Какая модель?')));
      await api('POST', `/api/requests/${id}/comments`, { token: tokens.emp, body: { body: 'Модель X' } });
      assert.ok(await waitMail((x) => x.to === 'buyer@corp.kz' && x.text.includes('Модель X')));
    });
    it('новая срочная заявка → всем снабженцам', async () => {
      outbox.length = 0;
      const id = await newReq('emp', { is_urgent: true });
      assert.ok(await waitMail((x) => x.to === 'buyer@corp.kz' && x.subject.includes(`№${id}`)));
      assert.ok(await waitMail((x) => x.to === 'buyer2@corp.kz' && x.subject.includes(`№${id}`)));
      assert.ok(!outbox.some((x) => x.to === 'emp@corp.kz'));
    });
    it('сбой SMTP не ломает основной запрос', async () => {
      const { config } = await import('../src/config.js');
      const saved = { ...config.smtp };
      Object.assign(config.smtp, { host: '127.0.0.1', port: 1 });
      try {
        const id = await newReq('emp');
        assert.equal((await api('PATCH', `/api/requests/${id}/status`, { token: tokens.buyer, body: { status: 'review' } })).status, 200);
      } finally { Object.assign(config.smtp, saved); }
    });
  });

  describe('список, фильтры, пагинация, CSV (B4, B5, F6)', () => {
    before(async () => {
      await pool.query('TRUNCATE requests RESTART IDENTITY CASCADE');
      await pool.query(
        `INSERT INTO requests (author_id, category_id, is_urgent, due_date, justification, status, assignee_id, created_at)
         SELECT $1, $2, g % 5 = 0, CASE WHEN g % 7 = 0 THEN CURRENT_DATE - 3 END, 'Заявка ' || g,
                CASE WHEN g % 11 = 0 THEN 'done' ELSE 'new' END, CASE WHEN g % 3 = 0 THEN $3::int END,
                now() - make_interval(mins => g)
           FROM generate_series(1, 1250) g`,
        [ids.emp, ids.cat, ids.buyer]);
      await pool.query(`INSERT INTO request_items (request_id, name, quantity) SELECT id, 'Позиция', 1 FROM requests`);
    });
    it('11. 1 000+ заявок: пагинация, правильный total, limit ≤ 100', async () => {
      const r = await api('GET', '/api/requests?page=2&limit=50', { token: tokens.buyer });
      assert.equal(r.json.total, 1250);
      assert.equal(r.json.requests.length, 50);
      assert.equal(r.json.page, 2);
      assert.equal((await api('GET', '/api/requests?limit=101', { token: tokens.buyer })).status, 400);
      assert.equal((await api('GET', '/api/requests?page=13&limit=100', { token: tokens.buyer })).json.requests.length, 50);
      assert.equal((await api('GET', '/api/requests?page=14&limit=100', { token: tokens.buyer })).json.requests.length, 0);
    });
    it('11. CSV выгружает все записи без лимита в 500 строк', async () => {
      const r = await api('GET', '/api/requests/export.csv', { token: tokens.buyer });
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/csv/);
      const lines = r.text.replace(/^\ufeff/, '').trim().split('\r\n');
      assert.equal(lines.length, 1251);
      assert.equal(new Set(lines.slice(1).map((l) => l.split(';')[0])).size, 1250);
      assert.equal((await api('GET', '/api/requests/export.csv?urgent=1', { token: tokens.buyer })).text.trim().split('\r\n').length, 251);
      assert.equal((await api('GET', '/api/requests/export.csv', { token: tokens.emp })).status, 403);
    });
    it('B4: фильтры статуса, срочности, ответственного, просроченных, категории, подразделения, периода, поиск', async () => {
      const q = async (s) => (await api('GET', `/api/requests?${s}`, { token: tokens.buyer })).json.total;
      const cnt = async (sql) => (await pool.query(sql)).rows[0].n;
      assert.equal(await q('urgent=1'), await cnt(`SELECT count(*)::int n FROM generate_series(1,1250) g WHERE g % 5 = 0`));
      assert.equal(await q('status=done'), await cnt(`SELECT count(*)::int n FROM generate_series(1,1250) g WHERE g % 11 = 0`));
      assert.equal(await q('assignee=me'), await cnt(`SELECT count(*)::int n FROM generate_series(1,1250) g WHERE g % 3 = 0`));
      assert.equal(await q('assignee=none'), await cnt(`SELECT count(*)::int n FROM generate_series(1,1250) g WHERE g % 3 <> 0`));
      assert.equal(await q('assignee=' + ids.buyer), await q('assignee=me'));
      assert.equal(await q(`category=${ids.cat}`), 1250);
      assert.equal(await q('category=999999'), 0);
      assert.equal(await q('overdue=1'), await cnt(`SELECT count(*)::int n FROM generate_series(1,1250) g WHERE g % 7 = 0 AND g % 11 <> 0`));
      assert.ok(await q(`from=${todayStr()}&to=${todayStr()}`) > 0);
      assert.equal(await q(`from=${addDays(todayStr(), 1)}`), 0);
      await pool.query(`UPDATE requests SET justification = 'уникальнаяфраза' WHERE id = 1000`);
      assert.equal(await q('q=' + encodeURIComponent('уникальнаяфраза')), 1);
      assert.equal(await q('q=1000'), 1);
      assert.equal(await q('q=' + encodeURIComponent('%')), 0); // спецсимволы LIKE экранированы
      assert.equal(await q(`department=${ids.dept}`), 1250);
    });
    it('B5: срочные и просроченные сверху, закрытые внизу', async () => {
      const rows = (await api('GET', '/api/requests?limit=100', { token: tokens.buyer })).json.requests;
      assert.ok(rows.slice(0, 20).every((x) => x.is_urgent || x.is_overdue));
      const firstDone = rows.findIndex((x) => x.status === 'done');
      assert.ok(firstDone === -1 || rows.slice(firstDone).every((x) => x.status === 'done'));
    });
    it('сотрудник видит только свои заявки', async () => {
      assert.equal((await api('GET', '/api/requests', { token: tokens.emp2 })).json.total, 0);
      assert.equal((await api('GET', '/api/requests?limit=1', { token: tokens.emp })).json.total, 1250);
    });
    it('статистика с периодом', async () => {
      assert.equal((await api('GET', '/api/stats', { token: tokens.buyer })).json.total, 1250);
      assert.equal((await api('GET', `/api/stats?from=${addDays(todayStr(), 5)}`, { token: tokens.buyer })).json.total, 0);
      assert.equal((await api('GET', '/api/stats', { token: tokens.emp })).status, 403);
    });
    it('F6: список из 20 заявок быстрее 300 мс на ~1 250 строках', async () => {
      const t = Date.now();
      await api('GET', '/api/requests?limit=20', { token: tokens.buyer });
      assert.ok(Date.now() - t < 300, `заняло ${Date.now() - t} мс`);
    });
  });

  describe('лимиты частоты (A7, A8)', () => {
    const login = (email, ip) => call(base2, 'POST', '/api/auth/login', { body: { email, password: 'wrongpass1' }, headers: ip ? { 'X-Forwarded-For': ip } : {} });
    it('12. подмена X-Forwarded-For без TRUST_PROXY не обходит лимит 10 попыток на IP+email', async () => {
      const codes = [];
      for (let i = 0; i < 12; i++) codes.push((await login('emp@corp.kz', `10.0.0.${i}`)).status);
      assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
      assert.deepEqual(codes.slice(10), [429, 429]);
    });
    it('общий лимит 50 неудачных попыток на IP (разные email)', async () => {
      // предыдущий тест потратил 12 попыток с этого IP → осталось 38
      const codes = new Set();
      for (let i = 0; i < 38; i++) codes.add((await login(`nobody${i}@corp.kz`, `10.1.0.${i}`)).status);
      assert.deepEqual([...codes], [401]);
      assert.equal((await login('nobody-final@corp.kz')).status, 429);
    });
    it('регистрация: 5 в час с IP, затем 429', async () => {
      const codes = [];
      for (let i = 0; i < 6; i++) codes.push((await call(base2, 'POST', '/api/auth/register', { body: { full_name: 'Тест Тестов', email: `r${i}@corp.kz`, password: 'password1' } })).status);
      assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
    });
  });

  describe('прочее', () => {
    it('неизвестный маршрут API → 404 JSON; без токена → 401', async () => {
      assert.equal((await api('GET', '/api/nope')).status, 404);
      assert.equal((await api('GET', '/api/requests')).status, 401);
      assert.equal((await api('GET', '/api/requests', { token: 'garbage' })).status, 401);
    });
    it('некорректный JSON → 400', async () => {
      assert.equal((await api('POST', '/api/auth/login', { raw: '{bad', headers: { 'Content-Type': 'application/json' } })).status, 400);
    });
  });
});
