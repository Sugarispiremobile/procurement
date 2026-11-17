import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { CLOSED, NEXT, ST, fmtDT, fmtDate, fmtMoney, isOverdue } from '../constants.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Track from '../components/Track.jsx';

function historyTitle(h) {
  if (h.kind === 'comment') return 'Комментарий снабжения';
  if (h.kind === 'edit') return 'Заявка отредактирована автором';
  return h.old_status ? `${ST[h.old_status].t} → ${ST[h.new_status].t}` : `Создана: ${ST[h.new_status].t}`;
}

export default function RequestPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const notify = useToast();
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/requests/${id}`)
      .then((d) => { setR(d); setComment(d.buyer_comment); })
      .catch((e) => setError(e.status === 404 ? 'Заявка не найдена' : e.full));
  }, [id]);

  if (error) return <div className="panel"><h2>{error}</h2><Link to="/requests">К списку заявок</Link></div>;
  if (!r) return <p className="empty">Загрузка…</p>;

  const isBuyer = user.role !== 'employee';
  const isOwner = r.author_id === user.id;

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const d = await fn();
      setR(d); setComment(d.buyer_comment); notify(okMsg);
    } catch (e) { notify(e.full, true); } finally { setBusy(false); }
  };

  const saveComment = () => run(() => api.patch(`/requests/${id}/status`, { comment: comment.trim() }), 'Комментарий сохранён');
  const move = (to) => {
    if (to === 'rejected' && !comment.trim()) return notify('Укажите причину отклонения в комментарии', true);
    return run(() => api.patch(`/requests/${id}/status`, { status: to, comment: comment.trim() }), `Статус: ${ST[to].t}`);
  };
  const cancel = () => {
    if (!confirm(`Отменить заявку №${id}?`)) return;
    return run(() => api.post(`/requests/${id}/cancel`), 'Заявка отменена');
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
        <h3 style={{ fontSize: 13, marginTop: 20 }}>Позиции</h3>
        <ul className="items">{r.items.map((i) => <li key={i.id}>{i.name} — <b>{i.quantity} {i.unit}</b></li>)}</ul>
        <h3 style={{ fontSize: 13, marginTop: 16 }}>Обоснование</h3>
        <p style={{ margin: '6px 0 0' }}>{r.justification}</p>
        {r.buyer_comment && !isBuyer && <div className="note"><b>Снабжение:</b> {r.buyer_comment}</div>}

        <details className="hist" open>
          <summary>История статусов ({r.history.length})</summary>
          <ul>
            {r.history.map((h) => (
              <li key={h.id}>
                <b>{historyTitle(h)}</b> · {h.changed_by} · {fmtDT(h.changed_at)}
                {h.kind === 'status' && h.comment && <div className="hist-note">Комментарий: {h.comment}</div>}
                {h.kind === 'comment' && <div className="hist-note">{h.comment || 'комментарий удалён'}</div>}
                {h.kind === 'edit' && <div className="hist-note">{h.comment}</div>}
              </li>
            ))}
          </ul>
        </details>

        {isOwner && r.status === 'new' && (
          <div className="acts">
            <Link className="btn ghost sm" to={`/requests/${r.id}/edit`}>Редактировать</Link>
            <button className="btn danger sm" disabled={busy} onClick={cancel}>Отменить заявку</button>
          </div>
        )}

        {isBuyer && CLOSED.includes(r.status) && r.buyer_comment && (
          <div className="note"><b>Комментарий снабжения:</b> {r.buyer_comment}</div>
        )}

        {isBuyer && !CLOSED.includes(r.status) && (
          <div className="acts">
            <input value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий для сотрудника" aria-label="Комментарий снабжения" />
            <button className="btn ghost sm" disabled={busy} onClick={saveComment}>Сохранить комментарий</button>
            {NEXT[r.status].map((k) => (
              <button key={k} disabled={busy} className={`btn sm ${k === 'rejected' ? 'danger' : 'ghost'}`} onClick={() => move(k)}>
                {k === 'rejected' ? 'Отклонить' : `→ ${ST[k].t}`}
              </button>
            ))}
          </div>
        )}
      </article>
    </>
  );
}
