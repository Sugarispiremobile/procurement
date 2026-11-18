import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context.jsx';
import Landing from './Landing.jsx';

export default function Invite() {
  const { token } = useParams();
  const { setSession } = useAuth();
  const nav = useNavigate();
  const [info, setInfo] = useState(null);
  const [bad, setBad] = useState('');
  const [pw, setPw] = useState('');
  const [repeat, setRepeat] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/auth/invite/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setBad(e.full));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) return setErr('Пароль — минимум 8 символов');
    if (pw !== repeat) return setErr('Пароли не совпадают');
    setErr(''); setBusy(true);
    try {
      const d = await api.post('/auth/accept-invite', { token, password: pw });
      setSession(d.token, d.user);
      nav('/requests', { replace: true });
    } catch (ex) { setErr(ex.full); } finally { setBusy(false); }
  };

  return (
    <Landing>
      {bad ? (
        <div className="panel auth"><h2>Ссылка недействительна</h2><p className="meta">{bad}</p><Link to="/login">Войти</Link></div>
      ) : !info ? (
        <div className="panel auth"><p className="empty">Проверяем ссылку…</p></div>
      ) : (
        <form className="panel auth" onSubmit={submit}>
          <h2>Добро пожаловать!</h2>
          <p className="meta">{info.full_name} · {info.email}<br />Придумайте пароль, чтобы войти в сервис.</p>
          <label htmlFor="ip">Пароль (минимум 8 символов)</label>
          <input id="ip" type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} />
          <label htmlFor="ir" style={{ marginTop: 12 }}>Повторите пароль</label>
          <input id="ir" type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          <p className="urgent" role="alert">{err}</p>
          <button className="btn" disabled={busy}>{busy ? 'Сохраняем…' : 'Установить пароль и войти'}</button>
        </form>
      )}
    </Landing>
  );
}
