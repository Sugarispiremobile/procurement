import { describe, it, expect } from 'vitest';
import { cfg, fmtMoney, fmtSize, isOverdue, todayStr, NEXT } from '../constants.js';

describe('constants', () => {
  it('сумма показывается в валюте из конфигурации', () => {
    expect(fmtMoney(1500)).toContain('₸');
    cfg.currency = '$';
    expect(fmtMoney(1500)).toContain('$');
    cfg.currency = '₸';
    expect(fmtMoney(null)).toBe('—');
  });

  it('размер файла', () => {
    expect(fmtSize(500)).toBe('500 Б');
    expect(fmtSize(2048)).toBe('2 КБ');
    expect(fmtSize(5 * 1048576)).toBe('5.0 МБ');
  });

  it('просрочка: серверный флаг важнее локального расчёта', () => {
    expect(isOverdue({ is_overdue: true, status: 'new' })).toBe(true);
    expect(isOverdue({ is_overdue: false, due_date: '2000-01-01', status: 'new' })).toBe(false);
    expect(isOverdue({ due_date: '2000-01-01', status: 'new' })).toBe(true);
    expect(isOverdue({ due_date: '2000-01-01', status: 'done' })).toBe(false);
  });

  it('«сегодня» — дата в формате ГГГГ-ММ-ДД', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('из закрытых статусов переходов нет', () => {
    for (const s of ['done', 'rejected', 'cancelled']) expect(NEXT[s]).toEqual([]);
  });
});
