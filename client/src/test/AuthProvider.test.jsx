import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = { get: vi.fn(), post: vi.fn() };
const setToken = vi.fn();
vi.mock('../api.js', () => ({ api, getToken: () => 'tok', setToken, setUnauthorizedHandler: () => {} }));

const { AuthProvider } = await import('../context.jsx');

beforeEach(() => { vi.resetAllMocks(); });

describe('AuthProvider: загрузка сессии (BUG-005)', () => {
  it('сбой сети или 5xx не стирает токен, показывается экран «Повторить»', async () => {
    api.get.mockRejectedValueOnce({ status: 0, full: 'Нет связи' });
    render(<AuthProvider><p>приложение</p></AuthProvider>);
    expect(await screen.findByText('Нет связи с сервером')).toBeInTheDocument();
    expect(setToken).not.toHaveBeenCalled();
    api.get.mockResolvedValueOnce({ user: { id: 1, role: 'buyer' } });
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('приложение')).toBeInTheDocument();
  });

  it('ответ 401 завершает сессию', async () => {
    api.get.mockRejectedValueOnce({ status: 401, full: 'Сессия истекла' });
    render(<AuthProvider><p>приложение</p></AuthProvider>);
    expect(await screen.findByText('приложение')).toBeInTheDocument();
    expect(setToken).toHaveBeenCalledWith(null);
  });
});
