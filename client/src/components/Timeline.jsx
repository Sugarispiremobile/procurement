import { FIELD_NAMES, ROLES, ST, fmtDT } from '../constants.js';

const eventText = (h) => {
  if (h.event === 'assigned') {
    const d = h.details ?? {};
    if (!d.assignee_name) return `снял(а) ответственного${d.previous_name ? ` (${d.previous_name})` : ''}`;
    return `${d.auto ? 'ответственным стал(а) (автоматически) ' : 'назначил(а) ответственным '}${d.assignee_name}`;
  }
  if (h.event === 'file_deleted') return `удалил(а) файл «${h.details?.file_name ?? ''}»`;
  if (h.event === 'edited') {
    const fields = (h.details?.changed ?? []).map((k) => FIELD_NAMES[k] ?? k).join(', ');
    return `изменил(а) заявку: ${fields}`;
  }
  return h.old_status ? `${ST[h.old_status].t} → ${ST[h.new_status].t}` : `создана: ${ST[h.new_status].t}`;
};

/** Хронологическая лента комментариев и событий истории (C3). Текст выводится как текст — React экранирует HTML (C4). */
export default function Timeline({ comments, history }) {
  const rows = [
    ...comments.map((c) => ({ key: `c${c.id}`, at: c.created_at, kind: 'comment', c })),
    ...history.map((h) => ({ key: `h${h.id}`, at: h.changed_at, kind: 'event', h })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at) || (a.kind === 'event' ? 0 : 1) - (b.kind === 'event' ? 0 : 1)); // при равном времени событие раньше комментария

  if (!rows.length) return <p className="meta">Пока ничего нет.</p>;
  return (
    <ol className="timeline">
      {rows.map((r) => (r.kind === 'comment' ? (
        <li key={r.key} className={`tl-comment${r.c.kind === 'rejection' ? ' rejection' : ''}`}>
          <div className="tl-head"><b>{r.c.author_name}</b>
            {r.c.author_role !== 'employee' && <span className="tl-role">{ROLES[r.c.author_role]}</span>}
            {r.c.kind === 'rejection' && <span className="tag late">причина отклонения</span>}
            <time>{fmtDT(r.at)}</time></div>
          <p>{r.c.body}</p>
        </li>
      ) : (
        <li key={r.key} className="tl-event">
          <span><b>{r.h.changed_by}</b> {eventText(r.h)}</span>
          {r.h.event === 'edited' && r.h.details?.items_before && <small>Было: {r.h.details.items_before.join('; ')}</small>}
          <time>{fmtDT(r.at)}</time>
        </li>
      )))}
    </ol>
  );
}
