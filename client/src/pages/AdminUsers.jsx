import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { ROLES, fmtDate } from '../constants.js';

export default function AdminUsers() {
  const { user: me } = useAuth();
  const notify = useToast();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/users').then((d) => setUsers(d.users)).catch((e) => setError(e.full));
  }, []);

  const setRole = async (u, role) => {
    try {
      const upd = await api.patch(`/users/${u.id}/role`, { role });
      setUsers(users.map((x) => (x.id === u.id ? { ...x, role: upd.role } : x)));
      notify(`${u.full_name}: ${ROLES[role]}`);
    } catch (e) { notify(e.full, true); }
  };

  return (
    <section className="panel">
      <h2>Пользователи и роли</h2>
      {error && <p className="urgent" role="alert">{error}</p>}
      {!users && !error && <p className="empty">Загрузка…</p>}
      {users && (
        <div className="tablewrap">
          <table className="t">
            <thead><tr><th>Имя</th><th>Email</th><th>Подразделение</th><th>Создан</th><th>Роль</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td><td>{u.email}</td><td>{u.department ?? '—'}</td><td>{fmtDate(u.created_at.slice(0, 10))}</td>
                  <td>
                    <select value={u.role} aria-label={`Роль: ${u.full_name}`} disabled={u.id === me.id} onChange={(e) => setRole(u, e.target.value)}>
                      {Object.entries(ROLES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
