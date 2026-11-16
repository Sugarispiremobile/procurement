import { ST } from '../constants.js';

export default function StatusBadge({ status }) {
  const s = ST[status];
  return <span className="badge" style={{ '--st': s.c }}>{s.t}</span>;
}
