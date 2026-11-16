import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context.jsx';
import Landing from './Landing.jsx';

export default function Register() {
  const { user, register } = useAuth();
  const nav = useNavigate();
  const [departments, setDepartments] = useState([]);
  const [f, setF] = useState({ full_name: '', email: '', password: '', department_id: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/departments').then((d) => setDepartments(d.items)).catch(() => {});
  }, []);

  if (user) return <Navigate to="/requests" replace />;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    if (f.password.length < 8) return setErr('Пароль — минимум 8 символов');
    setErr(''); setBusy(true);
    try {
      await register({ ...f, department_id: f.department_id ? Number(f.department_id) : null });
      nav('/requests', { replace: true });
    } catch (ex) {
      setErr(ex.full);
    } finally { setBusy(false); }
  };

  return (
    <Landing>
    <form className="panel auth" onSubmit={submit}>
      <h2>Регистрация</h2>
      <label htmlFor="fn">Ваше имя</label>
      <input id="fn" required maxLength={120} autoComplete="name" value={f.full_name} onChange={set('full_name')} />
      <label htmlFor="em" style={{ marginTop: 12 }}>Email</label>
      <input id="em" type="email" required autoComplete="email" value={f.email} onChange={set('email')} />
      <label htmlFor="pw" style={{ marginTop: 12 }}>Пароль (минимум 8 символов)</label>
      <input id="pw" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} />
      <label htmlFor="dp" style={{ marginTop: 12 }}>Подразделение</label>
      <select id="dp" value={f.department_id} onChange={set('department_id')}>
        <option value="">— не выбрано —</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <p className="urgent" role="alert">{err}</p>
      <button className="btn" disabled={busy}>{busy ? 'Создаём…' : 'Зарегистрироваться'}</button>
      <p className="meta">Уже есть аккаунт? <Link to="/login">Войти</Link></p>
    </form>
    </Landing>
  );
}
