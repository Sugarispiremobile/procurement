import { FLOW, ST } from '../constants.js';

/** Дорожка статуса: new → review → buying → done; для отклонённых/отменённых — штамп. */
export default function Track({ status }) {
  const s = ST[status];
  if (!FLOW.includes(status)) {
    return <span className="stamp" style={{ '--st': s.c }}>{s.t}</span>;
  }
  const at = FLOW.indexOf(status);
  return (
    <div style={{ '--st': s.c }} aria-label={`Этап: ${s.t}`}>
      <div className="track-l">
        {FLOW.map((k, i) => <span key={k} className={i === at ? 'cur' : ''}>{ST[k].t}</span>)}
      </div>
      <div className="track" aria-hidden="true">
        {FLOW.map((k, i) => (
          <span key={k} style={{ display: 'contents' }}>
            <b className={`${i <= at ? 'on' : ''} ${i === at ? 'cur' : ''}`} />
            {i < FLOW.length - 1 && <i className={i < at ? 'on' : ''} />}
          </span>
        ))}
      </div>
    </div>
  );
}
