import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Timeline from '../components/Timeline.jsx';

const comments = [
  { id: 1, kind: 'comment', body: '<b>жирный</b> текст', created_at: '2026-11-17T10:00:00Z', author_id: 2, author_name: 'Мария', author_role: 'buyer' },
  { id: 2, kind: 'rejection', body: 'Нет бюджета', created_at: '2026-11-17T12:00:00Z', author_id: 2, author_name: 'Мария', author_role: 'buyer' },
];
const history = [
  { id: 1, event: 'status', old_status: null, new_status: 'new', details: null, changed_at: '2026-11-17T09:00:00Z', changed_by: 'Анна' },
  { id: 2, event: 'edited', old_status: null, new_status: null, details: { changed: ['items'], items_before: ['Бумага — 2 шт.'] }, changed_at: '2026-11-17T09:30:00Z', changed_by: 'Анна' },
  { id: 3, event: 'assigned', old_status: null, new_status: null, details: { assignee_name: 'Мария', auto: true }, changed_at: '2026-11-17T11:00:00Z', changed_by: 'Мария' },
];

describe('Timeline', () => {
  it('показывает комментарии и события в хронологическом порядке', () => {
    render(<Timeline comments={comments} history={history} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('создана');
    expect(items[1]).toHaveTextContent('изменил(а) заявку: позиции');
    expect(items[1]).toHaveTextContent('Бумага — 2 шт.');
    expect(items[4]).toHaveTextContent('Нет бюджета');
  });

  it('HTML в комментарии выводится как текст', () => {
    const { container } = render(<Timeline comments={comments} history={[]} />);
    expect(screen.getByText('<b>жирный</b> текст')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeInTheDocument(); // только <b> автора, но не из текста
    expect(container.querySelectorAll('li p b')).toHaveLength(0);
  });

  it('причина отклонения помечена', () => {
    render(<Timeline comments={comments} history={[]} />);
    expect(screen.getByText('причина отклонения')).toBeInTheDocument();
  });

  it('пустая лента', () => {
    render(<Timeline comments={[]} history={[]} />);
    expect(screen.getByText('Пока ничего нет.')).toBeInTheDocument();
  });

  it('BUG-018: при равном времени событие «→ Отклонена» стоит раньше причины отклонения', () => {
    const t = '2026-11-17T12:00:00Z';
    render(<Timeline
      comments={[{ id: 9, kind: 'rejection', body: 'Нет бюджета', created_at: t, author_id: 2, author_name: 'Мария', author_role: 'buyer' }]}
      history={[{ id: 9, event: 'status', old_status: 'review', new_status: 'rejected', details: null, changed_at: t, changed_by: 'Мария' }]} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('→ Отклонена');
    expect(items[1]).toHaveTextContent('Нет бюджета');
  });
});
