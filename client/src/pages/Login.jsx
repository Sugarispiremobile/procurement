import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context.jsx';
import { cfg } from '../constants.js';
import Landing from './Landing.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/requests" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await login(email, password);
      nav(loc.state?.from || '/requests', { replace: true });
    } catch (ex) {
      setErr(ex.full);
    } finally { setBusy(false); }
  };

  const fill = (e, p) => { setEmail(e); setPassword(p); };

  return (
    <Landing>
    <form className="panel auth" onSubmit={submit}>
      <h2>Вход</h2>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password" style={{ marginTop: 12 }}>Пароль</label>
      <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <p className="urgent" role="alert">{err}</p>
      <button className="btn" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
      {cfg.registrationOpen
        ? <p className="meta">Нет аккаунта? <Link to="/register">Зарегистрироваться</Link></p>
        : <p className="meta">Доступ выдаёт администратор: вам придёт ссылка-приглашение.</p>}
      {import.meta.env.DEV && <div className="demo">
        Демо-доступ (пароль <code>demo12345</code>):{' '}
        <button type="button" onClick={() => fill('anna@example.com', 'demo12345')}>сотрудник</button>{' · '}
        <button type="button" onClick={() => fill('buyer@example.com', 'demo12345')}>снабжение</button>
      </div>}
    </form>
    </Landing>
  );
}
