import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { NEXT, ST, fmtDT, fmtDate, fmtMoney, isOverdue } from '../constants.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Track from '../components/Track.jsx';
import Timeline from '../components/Timeline.jsx';
import Files from '../components/Files.jsx';

export default function RequestPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const notify = useToast();
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState('');
  const [reason, setReason] = useState(null); // null — поле причины скрыто
  const [buyers, setBuyers] = useState([]);

  useEffect(() => {
    api.get(`/requests/${id}`).then(setR).catch((e) => setError(e.status === 404 ? 'Заявка не найдена' : e.full));
  }, [id]);

  const isAdmin = user.role === 'admin';
  useEffect(() => {
    if (!isAdmin) return;
    api.get('/users').then((d) => setBuyers(d.users.filter((u) => u.is_active && ['buyer', 'admin'].includes(u.role)))).catch(() => {});
  }, [isAdmin]);

  if (error) return <div className="panel"><h2>{error}</h2><Link to="/requests">К списку заявок</Link></div>;
  if (!r) return <p className="empty">Загрузка…</p>;

  const isBuyer = user.role !== 'employee';
  const isOwner = r.author_id === user.id;
  const closed = ['done', 'rejected', 'cancelled'].includes(r.status);
  const mine = r.assignee_id === user.id;
  // B3: менять статус может ответственный или админ; пока никого нет — любой снабженец
  // BUG-003: свою заявку снабженец не ведёт (сервер вернёт 403); администратор — исключение
  const ownLocked = isOwner && !isAdmin;
  const canMove = isBuyer && !closed && !ownLocked && (isAdmin || !r.assignee_id || mine);

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { setR(await fn()); if (okMsg) notify(okMsg); return true; } catch (e) { notify(e.full, true); return false; } finally { setBusy(false); }
  };
  const move = (to, comment) => run(() => api.patch(`/requests/${id}/status`, { status: to, comment }), `Статус: ${ST[to].t}`);
  const assign = (assigneeId) => run(() => api.post(`/requests/${id}/assign`, assigneeId === undefined ? {} : { assignee_id: assigneeId }), 'Ответственный обновлён');
  const cancel = () => confirm(`Отменить заявку №${id}?`) && run(() => api.post(`/requests/${id}/cancel`), 'Заявка отменена');
  const sendComment = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const d = await api.post(`/requests/${id}/comments`, { body: body.trim() });
      setR({ ...r, comments: d.comments });
      setBody('');
    } catch (ex) { notify(ex.full, true); } finally { setBusy(false); }
  };
  const reject = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return notify('Укажите причину отклонения', true);
    if (await move('rejected', reason.trim())) setReason(null);
  };

  return (
    <>
      <p><Link to="/requests">← К списку заявок</Link></p>
      <article className="req big" style={{ '--st': ST[r.status].c }}>
        <div className="top">
          <div>
            <span className="num">Заявка №{r.id}</span>
            <span className="title">
              {r.category}
              {r.is_urgent && <span className="tag">срочно</span>}
              {isOverdue(r) && <span className="tag late">просрочено</span>}
            </span>
          </div>
          <StatusBadge status={r.status} />
        </div>
        <div className="kv">
          <span>👤 <b>{r.author_name}</b>{r.department ? `, ${r.department}` : ''}</span>
          <span>🗓 создана <b>{fmtDT(r.created_at)}</b></span>
          <span>📅 нужно к <b>{fmtDate(r.due_date)}</b></span>
          <span>💰 <b>{fmtMoney(r.budget)}</b></span>
        </div>
        <Track status={r.status} />

        <h3 style={{ fontSize: 13, marginTop: 20 }}>Ответственный</h3>
        <div className="assignee">
          <span>{r.assignee_name ? <b>{r.assignee_name}</b> : <em className="meta">не назначен</em>}</span>
          {isBuyer && !closed && !ownLocked && !r.assignee_id && <button className="btn sm" type="button" disabled={busy} onClick={() => assign()}>Взять в работу</button>}
          {isBuyer && !closed && r.assignee_id && !mine && !isAdmin && <span className="meta">Заявку ведёт {r.assignee_name}</span>}
          {isAdmin && !closed && (
            <select aria-label="Назначить ответственного" value={r.assignee_id ?? ''} disabled={busy} onChange={(e) => assign(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— без ответственного —</option>
              {buyers.filter((b) => b.id !== r.author_id || b.role === 'admin').map((b) => <option key={b.id} value={b.id}>{b.full_name}</option>)}
            </select>
          )}
        </div>

        <h3 style={{ fontSize: 13, marginTop: 20 }}>Позиции</h3>
        <ul className="items">{r.items.map((i) => <li key={i.id}>{i.name} — <b>{i.quantity} {i.unit}</b></li>)}</ul>
        <h3 style={{ fontSize: 13, marginTop: 16 }}>Обоснование</h3>
        <p style={{ margin: '6px 0 0' }}>{r.justification}</p>

        <Files requestId={r.id} files={r.files} onChange={(files) => setR({ ...r, files })}
          canUpload={!closed && (isBuyer || isOwner)} meId={user.id} closed={closed} />

        {isOwner && r.status === 'new' && (
          <div className="acts">
            <Link className="btn ghost sm" to={`/requests/${r.id}/edit`}>Редактировать</Link>
            <button className="btn danger sm" disabled={busy} onClick={cancel}>Отменить заявку</button>
          </div>
        )}

        {isBuyer && !closed && ownLocked && <p className="meta">Свою заявку обрабатывает другой сотрудник снабжения или администратор.</p>}
        {isBuyer && !closed && !ownLocked && !canMove && <p className="meta">Менять статус может только ответственный ({r.assignee_name}) или администратор.</p>}
        {canMove && (
          <div className="acts">
            {NEXT[r.status].filter((k) => k !== 'rejected').map((k) => (
              <button key={k} disabled={busy} className="btn ghost sm" onClick={() => move(k)}>→ {ST[k].t}</button>
            ))}
            {NEXT[r.status].includes('rejected') && reason === null && <button className="btn danger sm" disabled={busy} onClick={() => setReason('')}>Отклонить…</button>}
          </div>
        )}
        {canMove && reason !== null && (
          <form className="reasonbox" onSubmit={reject}>
            <label htmlFor="reason">Причина отклонения (обязательно, увидит сотрудник)</label>
            <textarea id="reason" autoFocus maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="acts"><button className="btn danger sm" disabled={busy}>Отклонить заявку</button>
              <button type="button" className="btn ghost sm" onClick={() => setReason(null)}>Не отклонять</button></div>
          </form>
        )}

        <h3 style={{ fontSize: 13, marginTop: 24 }}>Переписка и история ({r.comments.length + r.history.length})</h3>
        <Timeline comments={r.comments} history={r.history} />
        <form className="commentform" onSubmit={sendComment}>
          <label htmlFor="cm" className="sr">Новый комментарий</label>
          <textarea id="cm" maxLength={1000} placeholder={isBuyer ? 'Комментарий или вопрос сотруднику' : 'Ответ или дополнение для снабжения'} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="acts"><button className="btn sm" disabled={busy || !body.trim()}>Отправить</button>
            <span className="meta">{body.length}/1000 · комментарии нельзя изменить или удалить</span></div>
        </form>
      </article>
    </>
  );
}
