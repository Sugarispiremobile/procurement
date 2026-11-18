import { Link } from 'react-router-dom';
import { ST, fmtDate, fmtMoney, isOverdue } from '../constants.js';
import StatusBadge from './StatusBadge.jsx';
import Track from './Track.jsx';

export default function RequestCard({ r, isBuyer, index = 0 }) {
  return (
    <Link to={`/requests/${r.id}`} className="req link" style={{ '--st': ST[r.status].c, '--i': Math.min(index, 12) }}>
      <div className="top">
        <div>
          <span className="num">№{r.id}</span>
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
        <span>📅 к <b>{fmtDate(r.due_date)}</b></span>
        <span>💰 <b>{fmtMoney(r.budget)}</b></span>
        {isBuyer && <span>🧑‍💼 {r.assignee_name ? <b>{r.assignee_name}</b> : <em>без ответственного</em>}</span>}
      </div>
      <ul className="items">{r.items.map((i) => <li key={i.id}>{i.name} — {i.quantity} {i.unit}</li>)}</ul>
      <Track status={r.status} />
      {r.last_comment && <div className="note"><b>Последний комментарий:</b> {r.last_comment}</div>}
    </Link>
  );
}
