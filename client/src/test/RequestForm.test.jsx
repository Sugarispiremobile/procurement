import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock('../api.js', () => ({ api }));
vi.mock('../context.jsx', () => ({ useToast: () => () => {}, useAuth: () => ({ user: { id: 7 } }) }));

const { default: RequestForm } = await import('../pages/RequestForm.jsx');

const renderForm = (path = '/requests/new') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/requests/new" element={<RequestForm />} />
      <Route path="/requests/:id/edit" element={<RequestForm />} />
      <Route path="/requests/:id" element={<p>карточка заявки</p>} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockResolvedValue({ items: [{ id: 1, name: 'Канцелярия' }] });
});

describe('RequestForm', () => {
  it('без позиции форма не отправляется', async () => {
    renderForm();
    await screen.findByLabelText('Категория');
    await userEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    expect(await screen.findByText('Добавьте хотя бы одну позицию.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('без обоснования форма не отправляется', async () => {
    renderForm();
    await screen.findByLabelText('Категория');
    await userEvent.type(screen.getByLabelText('Наименование'), 'Бумага');
    await userEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    expect(await screen.findByText(/Напишите обоснование/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('корректная заявка уходит на сервер, затем открывается карточка', async () => {
    api.post.mockResolvedValue({ id: 1001 });
    renderForm();
    await screen.findByLabelText('Категория');
    await userEvent.type(screen.getByLabelText('Наименование'), 'Бумага');
    await userEvent.type(screen.getByLabelText('Обоснование'), 'Заканчивается');
    await userEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/requests');
    expect(body.items).toEqual([{ name: 'Бумага', quantity: 1, unit: 'шт.' }]);
    expect(body.is_urgent).toBe(false);
    expect(await screen.findByText('карточка заявки')).toBeInTheDocument();
  });

  it('валюта берётся из конфигурации', async () => {
    renderForm();
    expect(await screen.findByText(/Ориентировочная сумма, ₸/)).toBeInTheDocument();
  });

  it('BUG-016: архивная категория заявки остаётся выбранной, даже если заявка пришла раньше категорий', async () => {
    api.get.mockImplementation((url) => (url === '/categories'
      ? new Promise((res) => setTimeout(() => res({ items: [{ id: 1, name: 'Канцелярия' }] }), 30))
      : Promise.resolve({ id: 5, status: 'new', author_id: 7, category_id: 9, category: 'Старая', is_urgent: false, due_date: null, budget: null, justification: 'x', items: [{ name: 'a', quantity: 1, unit: 'шт.' }] })));
    renderForm('/requests/5/edit');
    const select = await screen.findByLabelText('Категория');
    expect(select).toHaveValue('9');
    expect(screen.getByRole('option', { name: 'Старая (архив)' })).toBeInTheDocument();
  });

  it('BUG-016: чужая или не «новая» заявка — только сообщение, без формы', async () => {
    api.get.mockImplementation((url) => Promise.resolve(url === '/categories' ? { items: [{ id: 1, name: 'К' }] }
      : { id: 5, status: 'review', author_id: 7, category_id: 1, category: 'К', items: [] }));
    renderForm('/requests/5/edit');
    expect(await screen.findByText(/только в статусе «Новая»/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Категория')).toBeNull();
  });

  it('BUG-013: пустой список категорий — понятное сообщение, отправка заблокирована', async () => {
    api.get.mockResolvedValue({ items: [] });
    renderForm();
    expect(await screen.findByText(/Нет доступных категорий/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить заявку' })).toBeDisabled();
  });
});
