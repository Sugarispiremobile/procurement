import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestCard from '../components/RequestCard.jsx';

const r = {
  id: 1001, status: 'review', is_urgent: true, is_overdue: true, category: 'Канцелярия', author_name: 'Анна', department: 'ИТ',
  due_date: '2026-12-01', budget: 6500, assignee_name: null, last_comment: 'Уточните модель',
  items: [{ id: 1, name: 'Бумага', quantity: 2, unit: 'пач.' }],
};
const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('RequestCard', () => {
  it('показывает номер, метки срочности и просрочки, последний комментарий', () => {
    wrap(<RequestCard r={r} isBuyer={false} />);
    expect(screen.getByText('№1001')).toBeInTheDocument();
    expect(screen.getByText('срочно')).toBeInTheDocument();
    expect(screen.getByText('просрочено')).toBeInTheDocument();
    expect(screen.getByText(/Уточните модель/)).toBeInTheDocument();
  });

  it('снабжение видит ответственного (или его отсутствие)', () => {
    wrap(<RequestCard r={r} isBuyer />);
    expect(screen.getByText('без ответственного')).toBeInTheDocument();
  });

  it('сотрудник не видит поле ответственного', () => {
    wrap(<RequestCard r={r} isBuyer={false} />);
    expect(screen.queryByText('без ответственного')).not.toBeInTheDocument();
  });
});
