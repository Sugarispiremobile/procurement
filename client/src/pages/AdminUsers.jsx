import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { ROLES, fmtDay } from '../constants.js';

function InviteBox({ invite, onClose }) {
  const notify = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(invite.url); notify('Ссылка скопирована'); } catch { notify('Скопируйте ссылку вручную', true); }
  };
  return (
    <div className="note" role="status">
      <b>{invite.title}</b> Ссылка действует до {new Date(invite.expires_at).toLocaleString('ru-RU')}; на почту пользователя она тоже отправлена.
      <div className="acts"><input readOnly value={invite.url} aria-label="Ссылка-приглашение" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn ghost sm" onClick={copy}>Копировать</button>
        <button type="button" className="btn ghost sm" onClick={onClose}>Закрыть</button></div>
    </div>
  );
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const notify = useToast();
  const [users, setUsers] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ full_name: '', email: '', role: 'employee', department_id: '' });

  useEffect(() => {
    api.get('/users').then((d) => setUsers(d.users)).catch((e) => setError(e.full));
    api.get('/departments').then((d) => setDepartments(d.items)).catch(() => {});
  }, []);

  const patch = async (u, body, okMsg) => {
    try {
      const upd = await api.patch(`/users/${u.id}`, body);
      setUsers(users.map((x) => (x.id === u.id ? upd : x)));
      notify(okMsg);
    } catch (e) { notify(e.full, true); }
  };

  const create = async (e) => {
    e.preventDefault();
    try {
      const d = await api.post('/users', { ...f, department_id: f.department_id ? Number(f.department_id) : null });
      setUsers([...users, d.user]);
      setInvite({ title: `Пользователь ${d.user.full_name} создан.`, url: d.invite_url, expires_at: d.expires_at });
      setF({ full_name: '', email: '', role: 'employee', department_id: '' });
      setAdding(false);
    } catch (ex) { notify(ex.full, true); }
  };

  const reset = async (u) => {
    if (!confirm(`Сбросить пароль пользователю ${u.full_name}? Текущий пароль перестанет работать.`)) return;
    try {
      const d = await api.post(`/users/${u.id}/reset-password`);
      setUsers(users.map((x) => (x.id === u.id ? { ...x, pending_invite: true } : x)));
      setInvite({ title: `Пароль ${u.full_name} сброшен.`, url: d.invite_url, expires_at: d.expires_at });
    } catch (e) { notify(e.full, true); }
  };

  const status = (u) => (!u.is_active ? <span className="pill bad">Заблокирован</span> : u.pending_invite ? <span className="pill wait">Ждёт приглашения</span> : <span className="pill ok">Активен</span>);

  return (
    <section className="panel">
      <div className="listhead" style={{ marginBottom: 10 }}>
        <h2>Пользователи и доступ</h2>
        <button className="btn sm" type="button" onClick={() => setAdding(!adding)}>{adding ? 'Отмена' : '+ Добавить'}</button>
      </div>
      {invite && <InviteBox invite={invite} onClose={() => setInvite(null)} />}
      {adding && (
        <form className="grid addform" onSubmit={create}>
          <div><label htmlFor="un">ФИО</label><input id="un" required minLength={2} maxLength={120} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
          <div><label htmlFor="ue">Email</label><input id="ue" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><label htmlFor="ur">Роль</label>
            <select id="ur" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div><label htmlFor="ud">Подразделение</label>
            <select id="ud" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}>
              <option value="">— не выбрано —</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div className="full"><button className="btn">Создать и получить ссылку-приглашение</button></div>
        </form>
      )}
      {error && <p className="urgent" role="alert">{error}</p>}
      {!users && !error && <p className="empty">Загрузка…</p>}
      {users && (
        <div className="tablewrap">
          <table className="t">
            <thead><tr><th>Имя</th><th>Email</th><th>Подразделение</th><th>Создан</th><th>Роль</th><th>Статус</th><th /></tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id}>
                    <td data-label="Имя">{u.full_name}</td><td data-label="Email">{u.email}</td>
                    <td data-label="Подразделение">
                      <select value={u.department_id ?? ''} aria-label={`Подразделение: ${u.full_name}`} onChange={(e) => patch(u, { department_id: e.target.value ? Number(e.target.value) : null }, 'Подразделение изменено')}>
                        <option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </td>
                    <td data-label="Создан">{fmtDay(u.created_at)}</td>
                    <td data-label="Роль">
                      <select value={u.role} aria-label={`Роль: ${u.full_name}`} disabled={self} onChange={(e) => patch(u, { role: e.target.value }, `${u.full_name}: ${ROLES[e.target.value]}`)}>
                        {Object.entries(ROLES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                      </select>
                    </td>
                    <td data-label="Статус">{status(u)}</td>
                    <td className="rowacts">
                      {!self && (u.is_active
                        ? <button className="btn danger sm" type="button" onClick={() => confirm(`Заблокировать ${u.full_name}?`) && patch(u, { is_active: false }, 'Пользователь заблокирован')}>Заблокировать</button>
                        : <button className="btn ghost sm" type="button" onClick={() => patch(u, { is_active: true }, 'Пользователь разблокирован')}>Разблокировать</button>)}
                      {!self && <button className="btn ghost sm" type="button" onClick={() => reset(u)}>Сбросить пароль</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
