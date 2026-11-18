import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const api = { get: vi.fn() };
vi.mock('../api.js', () => ({ api, download: vi.fn() }));
vi.mock('../context.jsx', () => ({
  useAuth: () => ({ user: { id: 2, role: 'buyer', full_name: 'Мария' } }), useToast: () => () => {},
}));

const { default: RequestsPage } = await import('../pages/RequestsPage.jsx');

const row = (id) => ({
  id, status: 'new', is_urgent: false, is_overdue: false, category: 'Канцелярия', author_name: 'Анна', department: null,
  due_date: null, budget: null, assignee_name: null, last_comment: null, items: [{ id, name: 'Бумага', quantity: 1, unit: 'шт.' }],
});

beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockImplementation(async (url) => {
    if (url.startsWith('/stats')) return { total: 3, active: 3, unassigned: 3, urgent_active: 0, overdue: 0 };
    if (url.startsWith('/requests')) return { requests: [row(1002), row(1001)], total: 347, page: 1, limit: 20 };
    return { items: [] };
  });
});

const renderPage = (url = '/requests') => render(<MemoryRouter initialEntries={[url]}><RequestsPage /></MemoryRouter>);
const lastRequestsCall = () => api.get.mock.calls.map((c) => c[0]).filter((u) => u.startsWith('/requests')).at(-1);

describe('RequestsPage', () => {
  it('показывает счётчик «Показано N из M» и пагинацию', async () => {
    renderPage();
    expect(await screen.findByText('Показано 2 из 347')).toBeInTheDocument();
    expect(screen.getByText('Стр. 1 из 18')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← Назад' })).toBeDisabled();
  });

  it('фильтры читаются из адресной строки', async () => {
    renderPage('/requests?urgent=1&assignee=me&page=2');
    await screen.findByText('Показано 2 из 347');
    const url = lastRequestsCall();
    expect(url).toContain('urgent=1');
    expect(url).toContain('assignee=me');
    expect(url).toContain('page=2');
    expect(url).toContain('limit=20');
  });

  it('включение фильтра «Срочные» перезапрашивает список', async () => {
    renderPage();
    await screen.findByText('Показано 2 из 347');
    await userEvent.click(screen.getByLabelText('Срочные'));
    await waitFor(() => expect(lastRequestsCall()).toContain('urgent=1'));
  });

  it('переход на следующую страницу', async () => {
    renderPage();
    await screen.findByText('Показано 2 из 347');
    await userEvent.click(screen.getByRole('button', { name: 'Вперёд →' }));
    await waitFor(() => expect(lastRequestsCall()).toContain('page=2'));
  });
});
