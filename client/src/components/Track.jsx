import { FLOW, ST } from '../constants.js';

/** Дорожка статуса: new → review → buying → done (подпись под каждой точкой); для отклонённых/отменённых — штамп. */
export default function Track({ status }) {
  const s = ST[status];
  if (!FLOW.includes(status)) {
    return <span className="stamp" style={{ '--st': s.c }}>{s.t}</span>;
  }
  const at = FLOW.indexOf(status);
  return (
    <ol className="track" style={{ '--st': s.c }} aria-label={`Этап: ${s.t}`}>
      {FLOW.map((k, i) => (
        <li key={k} className={`${i <= at ? 'on' : ''} ${i === at ? 'cur' : ''}`.trim()} aria-current={i === at ? 'step' : undefined}>
          <b aria-hidden="true" />
          <span>{ST[k].t}</span>
        </li>
      ))}
    </ol>
  );
}
