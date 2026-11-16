import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, useTheme } from './context.jsx';
import { ROLES, initials } from './constants.js';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import RequestsPage from './pages/RequestsPage.jsx';
import RequestForm from './pages/RequestForm.jsx';
import RequestPage from './pages/RequestPage.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AdminDictionaries from './pages/AdminDictionaries.jsx';
import DocPage from './pages/DocPage.jsx';
import specHtml from './docs/spec.html?raw';
import compHtml from './docs/competitors.html?raw';

function Layout() {
  const { user, logout } = useAuth();
  const toggleTheme = useTheme();
  return (
    <div className="wrap">
      <header>
        <Link to="/" className="brand">
          <span className="logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>
          </span>
          <span>Снабжение<small>заявки на закупку</small></span>
        </Link>
        <div className="hctl">
          {user && (
            <div className="me">
              <span className="avatar">{initials(user.full_name)}</span>
              <div><b>{user.full_name}</b><span>{ROLES[user.role]}</span></div>
            </div>
          )}
          <button className="btn ghost sm icon" type="button" onClick={toggleTheme} aria-label="Сменить тему" title="Сменить тему">◐</button>
          {user ? <button className="btn ghost sm" type="button" onClick={logout}>Выйти</button> : <Link className="btn ghost sm" to="/login">Войти</Link>}
        </div>
      </header>
      <nav className="tabs" aria-label="Разделы">
        {user && <NavLink to="/requests" end>Заявки</NavLink>}
        {user?.role === 'employee' && <NavLink to="/requests/new">+ Новая заявка</NavLink>}
        {user?.role === 'admin' && <NavLink to="/admin/users">Пользователи</NavLink>}
        {user?.role === 'admin' && <NavLink to="/admin/dictionaries">Справочники</NavLink>}
        <span className="sep" />
        <NavLink to="/docs/spec">ТЗ</NavLink>
        <NavLink to="/docs/competitors">Конкуренты</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}

/** Закрывает страницу от неавторизованных и от ролей, которым она не положена. */
function Guard({ roles }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <p className="empty">Загрузка…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return <div className="panel"><h2>Нет доступа</h2><p className="meta">У вашей роли нет прав на эту страницу.</p><Link to="/requests">К списку заявок</Link></div>;
  }
  return <Outlet />;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <p className="empty">Загрузка…</p>;
  return <Navigate to={user ? '/requests' : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="docs/spec" element={<DocPage html={specHtml} />} />
        <Route path="docs/competitors" element={<DocPage html={compHtml} />} />

        <Route element={<Guard />}>
          <Route path="requests" element={<RequestsPage />} />
          <Route path="requests/:id" element={<RequestPage />} />
        </Route>
        <Route element={<Guard roles={['employee']} />}>
          <Route path="requests/new" element={<RequestForm />} />
          <Route path="requests/:id/edit" element={<RequestForm />} />
        </Route>
        <Route element={<Guard roles={['admin']} />}>
          <Route path="admin/users" element={<AdminUsers />} />
          <Route path="admin/dictionaries" element={<AdminDictionaries />} />
        </Route>
        <Route path="*" element={<div className="panel"><h2>Страница не найдена</h2><Link to="/">На главную</Link></div>} />
      </Route>
    </Routes>
  );
}
