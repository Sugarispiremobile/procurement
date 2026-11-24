import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { cfg } from './constants.js';

/* ---------- настройки сервера (валюта, часовой пояс, регистрация) ---------- */
export function ConfigProvider({ children }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api.get('/config').then((d) => Object.assign(cfg, d)).catch(() => {}).finally(() => setReady(true));
  }, []);
  return ready ? children : <p className="empty">Загрузка…</p>;
}

/* ---------- авторизация ---------- */
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [bootError, setBootError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const logout = useCallback(() => { setToken(null); setUser(null); }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    // выходим только при 401; сбой сети или 5xx (например, перезапуск сервера) сессию не стирает
    setBootError(null); setLoading(true);
    api.get('/auth/me').then((d) => setUser(d.user)).catch((e) => {
      if (e?.status === 401) logout(); else setBootError(e?.full || 'Нет связи с сервером');
    }).finally(() => setLoading(false));
  }, [logout, attempt]);

  const value = useMemo(() => ({
    user, loading, logout,
    async login(email, password) {
      const d = await api.post('/auth/login', { email, password });
      setToken(d.token); setUser(d.user);
    },
    async register(payload) {
      const d = await api.post('/auth/register', payload);
      setToken(d.token); setUser(d.user);
    },
    /** Сохраняет сессию после принятия приглашения / смены пароля. */
    setSession(token, u) { setToken(token); if (u) setUser(u); },
    setUser,
  }), [user, loading, logout]);

  if (bootError) {
    return (
      <div className="panel" role="alert">
        <h2>Нет связи с сервером</h2>
        <p className="meta">{bootError}. Ваша сессия сохранена — попробуйте ещё раз.</p>
        <button className="btn" type="button" onClick={() => setAttempt((a) => a + 1)}>Повторить</button>
      </div>
    );
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

/* ---------- уведомления ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const timer = useRef();
  const notify = useCallback((text, bad = false) => {
    setMsg({ text, bad });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="toast" role="status" aria-live="polite" style={{ display: msg ? 'block' : 'none', background: msg?.bad ? 'var(--bad)' : undefined, color: msg?.bad ? '#fff' : undefined }}>
        {msg?.text}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- тема ---------- */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('procurement-theme'); } catch { return null; }
  });
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }, [theme]);
  const toggle = () => {
    const dark = theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('procurement-theme', next); } catch { /* ignore */ }
  };
  return toggle;
}
