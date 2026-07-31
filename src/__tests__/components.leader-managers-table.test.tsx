import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { LeaderManagersTable } from '@/components/leader/leader-managers-table';
import type { LeaderManagerRow } from '@/lib/services/leader/dashboard';
import { fmtMoney } from '@/lib/format';

function makeRow(overrides: Partial<LeaderManagerRow> = {}): LeaderManagerRow {
  return {
    managerId: 'mgr-1',
    name: 'Иван Менеджеров',
    email: 'ivan@example.com',
    activeOrders: 3,
    totalAmount: '120000.00',
    paidAmount: '80000.00',
    overdue: 0,
    ...overrides,
  };
}

describe('LeaderManagersTable', () => {
  it('renders a row per manager with names, emails and formatted money', () => {
    const rows: LeaderManagerRow[] = [
      makeRow(),
      makeRow({
        managerId: 'mgr-2',
        name: 'Пётр Сидоров',
        email: 'petr@example.com',
        activeOrders: 1,
        totalAmount: '50000.00',
        paidAmount: '50000.00',
        overdue: 2,
      }),
    ];
    const html = renderToString(<LeaderManagersTable rows={rows} />);

    expect(html).toContain('Иван Менеджеров');
    expect(html).toContain('ivan@example.com');
    expect(html).toContain('Пётр Сидоров');
    expect(html).toContain('petr@example.com');

    // fmtMoney emits ru-RU groupings with NBSP ( ) thin spaces.
    expect(html).toContain(fmtMoney('120000.00'));
    expect(html).toContain(fmtMoney('50000.00'));
  });

  it('highlights overdue > 0 in red and keeps zero overdue neutral', () => {
    const html = renderToString(<LeaderManagersTable rows={[makeRow({ overdue: 5 })]} />);
    expect(html).toContain('text-red-700');
  });

  it('renders neutral (no red) when no manager is overdue', () => {
    const html = renderToString(<LeaderManagersTable rows={[makeRow({ overdue: 0 })]} />);
    expect(html).not.toContain('text-red-700');
  });

  it('shows the empty state when there are no managers', () => {
    const html = renderToString(<LeaderManagersTable rows={[]} />);
    expect(html).toContain('В компании пока нет менеджеров.');
  });
});
