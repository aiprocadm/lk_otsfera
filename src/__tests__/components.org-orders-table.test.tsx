import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children)
}));

import { OrgOrdersTable, OrgOrdersCardList } from '@/components/organization/org-orders-table';
import type { OrgOrderRow } from '@/lib/services/organization/orders';

function baseRow(overrides: Partial<OrgOrderRow> = {}): OrgOrderRow {
  return {
    id: 'o1',
    orderNumber: '10',
    title: 'Заказ 1',
    totalAmount: '1000.00',
    paidAmount: '0.00',
    debt: '1000.00',
    executionStatus: 'in_progress',
    financialStatus: 'billed',
    stage: { label: 'В работе', tone: 'neutral' },
    createdAt: new Date('2026-01-01'),
    deadline: new Date('2026-02-01'),
    managerName: 'Иванов',
    ...overrides
  };
}

describe('OrgOrdersTable', () => {
  it('renders the empty state when rows is empty', () => {
    const html = renderToString(React.createElement(OrgOrdersTable, { rows: [], orgParam: null }));
    expect(html).toContain('По выбранным фильтрам заказов нет');
  });

  it('renders a row with org query param appended to the detail link when orgParam is set', () => {
    const html = renderToString(
      React.createElement(OrgOrdersTable, { rows: [baseRow()], orgParam: 'org1' })
    );
    expect(html).toContain('href="/organization/orders/o1?org=org1"');
    expect(html).toContain('Иванов');
    expect(html).toContain('text-red-700');
  });

  it('renders the detail link without org param when orgParam is null, and gray debt when zero', () => {
    const html = renderToString(
      React.createElement(OrgOrdersTable, {
        rows: [baseRow({ debt: '0.00', managerName: null, orderNumber: null, deadline: null })],
        orgParam: null
      })
    );
    expect(html).toContain('href="/organization/orders/o1"');
    expect(html).not.toContain('org=');
    expect(html).not.toContain('text-red-700');
  });
});

describe('OrgOrdersCardList', () => {
  it('renders null (nothing) when rows is empty', () => {
    const html = renderToString(React.createElement(OrgOrdersCardList, { rows: [], orgParam: null }));
    expect(html).toBe('');
  });

  it('renders a card with manager name and org param in the link', () => {
    const html = renderToString(
      React.createElement(OrgOrdersCardList, { rows: [baseRow()], orgParam: 'org1' })
    );
    expect(html).toContain('href="/organization/orders/o1?org=org1"');
    expect(html).toContain('Иванов');
    expect(html).not.toContain('без менеджера');
  });

  it('renders fallback "без менеджера" text when managerName is null', () => {
    const html = renderToString(
      React.createElement(OrgOrdersCardList, {
        rows: [baseRow({ managerName: null })],
        orgParam: null
      })
    );
    expect(html).toContain('без менеджера');
    expect(html).toContain('href="/organization/orders/o1"');
  });

  it('renders a dash for the order number when orderNumber is null but managerName is present', () => {
    const html = renderToString(
      React.createElement(OrgOrdersCardList, {
        rows: [baseRow({ orderNumber: null })],
        orgParam: null
      })
    );
    expect(html).toContain('Иванов');
    expect(html).not.toContain('без менеджера');
  });
});
