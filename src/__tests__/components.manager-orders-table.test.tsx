import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children)
}));
vi.mock('@/components/partner/deal-status-badge', () => ({
  DealStatusBadge: ({ stage }: { stage: { label: string } }) => React.createElement('span', null, stage.label)
}));

import { ManagerOrdersTable } from '@/components/manager/manager-orders-table';
import type { ManagerOrderRow } from '@/lib/services/manager/orders';

function makeRow(overrides: Partial<ManagerOrderRow>): ManagerOrderRow {
  return {
    id: 'o1',
    orderNumber: 'A-1',
    title: 'Заказ X',
    totalAmount: '1000' as unknown as ManagerOrderRow['totalAmount'],
    paidAmount: '500' as unknown as ManagerOrderRow['paidAmount'],
    executionStatus: 'in_progress',
    financialStatus: 'partially_paid',
    organization: { id: 'g1', name: 'Орг' },
    manager: { id: 'm1', name: 'Иван' },
    ...overrides
  } as ManagerOrderRow;
}

describe('ManagerOrdersTable', () => {
  it('empty: renders EmptyState message', () => {
    const html = renderToString(
      React.createElement(ManagerOrdersTable, { rows: [], nextCursor: null, searchParams: {} })
    );
    expect(html).toContain('По выбранным фильтрам заказов нет');
  });

  it('non-empty: renders order row with org, amounts, manager', () => {
    const rows = [makeRow({})];
    const html = renderToString(
      React.createElement(ManagerOrdersTable, { rows, nextCursor: null, searchParams: {} })
    );
    expect(html).toContain('href="/manager/orders/o1"');
    expect(html).toContain('Заказ X');
    expect(html).toContain('Орг');
    expect(html).toContain('Иван');
    expect(html).toContain('A-1');
  });

  it('renders — for missing orderNumber and manager', () => {
    const rows = [makeRow({ orderNumber: null, manager: null })];
    const html = renderToString(
      React.createElement(ManagerOrdersTable, { rows, nextCursor: null, searchParams: {} })
    );
    expect(html).toContain('—');
  });

  it('renders "Дальше" link with basePath default (/manager) when nextCursor is set', () => {
    const rows = [makeRow({})];
    const html = renderToString(
      React.createElement(ManagerOrdersTable, {
        rows,
        nextCursor: 'cur1',
        searchParams: { search: 'x', executionStatus: 'pending', financialStatus: 'billed', organizationId: 'g1' }
      })
    );
    expect(html).toContain('Дальше');
    expect(html).toContain('/manager/orders?');
    expect(html).toContain('cursor=cur1');
  });

  it('сохраняет unassigned=1 в ссылке «Дальше» (фильтр переживает пагинацию)', () => {
    const rows = [makeRow({})];
    const html = renderToString(
      React.createElement(ManagerOrdersTable, {
        rows,
        nextCursor: 'cur1',
        searchParams: { unassigned: '1' }
      })
    );
    expect(html).toContain('unassigned=1');
    expect(html).toContain('cursor=cur1');
  });

  it('respects a custom basePath for both row and next-page links', () => {
    const rows = [makeRow({})];
    const html = renderToString(
      React.createElement(ManagerOrdersTable, {
        rows,
        nextCursor: 'cur1',
        searchParams: {},
        basePath: '/leader'
      })
    );
    expect(html).toContain('href="/leader/orders/o1"');
    expect(html).toContain('/leader/orders?cursor=cur1');
  });

  it('does not render "Дальше" link when nextCursor is null', () => {
    const rows = [makeRow({})];
    const html = renderToString(
      React.createElement(ManagerOrdersTable, { rows, nextCursor: null, searchParams: {} })
    );
    expect(html).not.toContain('Дальше');
  });
});
