import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = { user: null, loading: false };
vi.mock('../context.jsx', () => ({
  useAuth: () => auth, useTheme: () => () => {}, useToast: () => () => {},
}));

const { Guard } = await import('../App.jsx');

const app = (roles) => (
  <MemoryRouter initialEntries={['/secret']}>
    <Routes>
      <Route path="/login" element={<p>страница входа</p>} />
      <Route element={<Guard roles={roles} />}>
        <Route path="/secret" element={<p>секрет</p>} />
      </Route>
    </Routes>
  </MemoryRouter>
);

describe('Guard', () => {
  it('гость перенаправляется на вход', () => {
    Object.assign(auth, { user: null, loading: false });
    render(app());
    expect(screen.getByText('страница входа')).toBeInTheDocument();
  });

  it('пока идёт загрузка — индикатор', () => {
    Object.assign(auth, { user: null, loading: true });
    render(app());
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
  });

  it('роль без прав получает «Нет доступа»', () => {
    Object.assign(auth, { user: { role: 'employee' }, loading: false });
    render(app(['admin']));
    expect(screen.getByText('Нет доступа')).toBeInTheDocument();
    expect(screen.queryByText('секрет')).not.toBeInTheDocument();
  });

  it('подходящая роль видит страницу', () => {
    Object.assign(auth, { user: { role: 'admin' }, loading: false });
    render(app(['admin']));
    expect(screen.getByText('секрет')).toBeInTheDocument();
  });
});
