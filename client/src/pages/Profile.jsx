import { useState } from 'react';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { ROLES } from '../constants.js';

export default function Profile() {
  const { user, setUser, setSession, logout } = useAuth();
  const notify = useToast();
  const [name, setName] = useState(user.full_name);
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const saveMe = async (patch, okMsg) => {
    try {
      const d = await api.patch('/auth/me', patch);
      setUser({ ...user, ...d.user });
      notify(okMsg);
    } catch (e) { notify(e.full, true); }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next.length < 8) return setErr('Новый пароль — минимум 8 символов');
    if (pw.next !== pw.repeat) return setErr('Пароли не совпадают');
    setErr(''); setBusy(true);
    try {
      const d = await api.post('/auth/change-password', { current_password: pw.current, new_password: pw.next });
      setSession(d.token); // остальные устройства выйдут, здесь сессия продолжается
      setPw({ current: '', next: '', repeat: '' });
      notify('Пароль изменён');
    } catch (ex) { setErr(ex.full); } finally { setBusy(false); }
  };

  const logoutAll = async () => {
    if (!confirm('Выйти на всех устройствах, включая это?')) return;
    try { await api.post('/auth/logout-all'); logout(); } catch (e) { notify(e.full, true); }
  };

  return (
    <>
      <section className="panel">
        <h2>Профиль</h2>
        <div className="grid" style={{ marginTop: 14 }}>
          <div><label htmlFor="pn">Имя</label>
            <div className="acts" style={{ margin: 0 }}>
              <input id="pn" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              <button className="btn ghost sm" type="button" disabled={name.trim() === user.full_name || name.trim().length < 2} onClick={() => saveMe({ full_name: name.trim() }, 'Имя сохранено')}>Сохранить</button>
            </div>
          </div>
          <div><label htmlFor="pe">Email</label><input id="pe" value={user.email} disabled /></div>
          <div><label htmlFor="pd">Подразделение</label><input id="pd" value={user.department ?? '—'} disabled />
            <p className="meta" style={{ margin: '4px 0 0' }}>Меняет администратор.</p></div>
          <div><label htmlFor="pr">Роль</label><input id="pr" value={ROLES[user.role]} disabled /></div>
        </div>
        <label className="check" style={{ marginTop: 18 }}>
          <input type="checkbox" checked={user.notify_email} onChange={(e) => saveMe({ notify_email: e.target.checked }, e.target.checked ? 'Уведомления включены' : 'Уведомления отключены')} />
          Получать уведомления по email (статусы, комментарии, назначения)
        </label>
      </section>

      <form className="panel" onSubmit={changePassword}>
        <h2>Смена пароля</h2>
        <div className="grid" style={{ marginTop: 14 }}>
          <div className="full"><label htmlFor="cp">Текущий пароль</label>
            <input id="cp" type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
          <div><label htmlFor="np">Новый пароль (минимум 8 символов)</label>
            <input id="np" type="password" autoComplete="new-password" required minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
          <div><label htmlFor="rp">Повторите новый пароль</label>
            <input id="rp" type="password" autoComplete="new-password" required value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} /></div>
        </div>
        <p className="urgent" role="alert" style={{ margin: '10px 0 0' }}>{err}</p>
        <div className="btnrow"><button className="btn" disabled={busy}>Сменить пароль</button></div>
        <p className="meta">После смены пароля вы выйдете на всех остальных устройствах.</p>
      </form>

      <section className="panel">
        <h2>Сессии</h2>
        <p className="meta">Если потеряли устройство или подозреваете, что вашим аккаунтом пользуется кто-то ещё.</p>
        <button className="btn danger sm" type="button" onClick={logoutAll}>Выйти на всех устройствах</button>
      </section>
    </>
  );
}
