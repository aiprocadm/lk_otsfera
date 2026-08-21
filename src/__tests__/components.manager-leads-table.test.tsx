import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));
vi.mock('@/components/partner/lead-status-badge', () => ({
  LeadStatusBadge: ({ status }: { status: string }) => React.createElement('span', null, status),
}));

import { ManagerLeadsTable } from '@/components/manager/manager-leads-table';
import type { ManagerLeadRow } from '@/lib/services/manager/leads';

function makeRow(overrides: Partial<ManagerLeadRow>): ManagerLeadRow {
  return {
    id: 'l1',
    clientCompanyName: 'ООО Клиент',
    clientInn: '1234567890',
    subject: 'Обучение по ОТ',
    partnerName: 'Партнёр Иванов',
    estimatedAmount: '5000',
    status: 'in_review',
    assignedManagerName: 'Менеджер Петров',
    ...overrides,
  } as ManagerLeadRow;
}

describe('ManagerLeadsTable', () => {
  it('empty: renders the EmptyState message', () => {
    const html = renderToString(
      React.createElement(ManagerLeadsTable, { rows: [], nextCursor: null, query: {} })
    );
    expect(html).toContain('По выбранным фильтрам заявок нет');
  });

  it('non-empty: renders lead row with client, subject, partner, amount, manager', () => {
    const rows = [makeRow({})];
    const html = renderToString(
      React.createElement(ManagerLeadsTable, { rows, nextCursor: null, query: {} })
    );
    expect(html).toContain('href="/manager/leads/l1"');
    expect(html).toContain('ООО Клиент');
    expect(html).toContain('ИНН <!-- -->1234567890');
    expect(html).toContain('Обучение по ОТ');
    expect(html).toContain('Партнёр Иванов');
    expect(html).toContain('₽'); // formatted money renders with the currency sign
    expect(html).toContain('Менеджер Петров');
  });

  it('пустые ИНН, оценка и менеджер: в таблице строки нет, в карточке — прочерк', () => {
    const rows = [makeRow({ clientInn: null, estimatedAmount: null, assignedManagerName: null })];
    const html = renderToString(
      React.createElement(ManagerLeadsTable, { rows, nextCursor: null, query: {} })
    );
    // `У-18`: рядом с таблицей живёт карточный вид для телефона. В таблице
    // строка ИНН не рисуется вовсе, а карточка по правилу примитива
    // показывает подпись с прочерком — поэтому слово встречается РОВНО раз.
    expect(html.split('ИНН').length - 1).toBe(1);
    expect(html).toContain('—');
  });

  it('заполненный ИНН виден и в таблице, и в карточке', () => {
    const rows = [makeRow({ clientInn: '7712345678' })];
    const html = renderToString(
      React.createElement(ManagerLeadsTable, { rows, nextCursor: null, query: {} })
    );
    expect(html.split('7712345678').length - 1).toBe(2);
  });

  it('renders "Дальше" link carrying status/q/assignedToMe + cursor', () => {
    const rows = [makeRow({})];
    const html = renderToString(
      React.createElement(ManagerLeadsTable, {
        rows,
        nextCursor: 'cur1',
        query: { status: 'qualified', q: 'abc', assignedToMe: '1' },
      })
    );
    expect(html).toContain('Дальше');
    expect(html).toContain('status=qualified');
    expect(html).toContain('q=abc');
    expect(html).toContain('assignedToMe=1');
    expect(html).toContain('cursor=cur1');
  });

  it('does not render "Дальше" link when nextCursor is null', () => {
    const rows = [makeRow({})];
    const html = renderToString(
      React.createElement(ManagerLeadsTable, { rows, nextCursor: null, query: {} })
    );
    expect(html).not.toContain('Дальше');
  });
});
