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

import { PartnerOrdersTable } from '@/components/partner/orders-table';
import type { PartnerOrderRow } from '@/lib/services/partner/orders';

function makeRow(overrides: Partial<PartnerOrderRow> = {}): PartnerOrderRow {
  return {
    id: 'd1',
    orderNumber: 'A-1',
    title: 'Заказ X',
    totalAmount: '1000.00',
    paidAmount: '0.00',
    debt: '1000.00',
    executionStatus: 'pending',
    financialStatus: 'not_billed',
    stage: { label: 'Новый', tone: 'neutral' },
    organizationName: 'ООО Ромашка',
    organizationId: 'o1',
    createdAt: new Date('2026-01-01'),
    deadline: new Date('2026-02-01'),
    closedAt: null,
    ...overrides,
  };
}

describe('PartnerOrdersTable', () => {
  it('empty: renders EmptyState message', () => {
    const html = renderToString(React.createElement(PartnerOrdersTable, { rows: [] }));
    expect(html).toContain('По выбранным фильтрам заказов нет');
  });

  it('renders a row with org link, amounts, deadline and red debt styling', () => {
    const html = renderToString(React.createElement(PartnerOrdersTable, { rows: [makeRow()] }));
    expect(html).toContain('href="/partner/orders/d1"');
    expect(html).toContain('Заказ X');
    expect(html).toContain('href="/partner/portfolio/o1"');
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('text-red-700 font-medium');
    expect(html).toContain('A-1');
  });

  it('renders — for missing orderNumber and deadline', () => {
    const html = renderToString(
      React.createElement(PartnerOrdersTable, {
        rows: [makeRow({ orderNumber: null, deadline: null })],
      })
    );
    expect(html).toContain('—');
  });

  it('renders organizationName as plain text (no link) when organizationId is null', () => {
    const html = renderToString(
      React.createElement(PartnerOrdersTable, { rows: [makeRow({ organizationId: null })] })
    );
    expect(html).not.toContain('/partner/portfolio/');
    expect(html).toContain('ООО Ромашка');
  });

  it('renders neutral debt styling (no red) when debt is 0', () => {
    const html = renderToString(
      React.createElement(PartnerOrdersTable, { rows: [makeRow({ debt: '0.00' })] })
    );
    expect(html).not.toContain('text-red-700 font-medium');
  });
});
