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

import { DealsCardList } from '@/components/partner/deals-card-list';
import type { DealRow } from '@/lib/services/partner/deals';

function makeRow(overrides: Partial<DealRow> = {}): DealRow {
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

describe('DealsCardList', () => {
  it('empty: renders nothing', () => {
    const html = renderToString(React.createElement(DealsCardList, { rows: [] }));
    expect(html).toBe('');
  });

  it('renders card with order number, org name, debt and deadline', () => {
    const html = renderToString(React.createElement(DealsCardList, { rows: [makeRow()] }));
    expect(html).toContain('href="/partner/deals/d1"');
    expect(html).toContain('Заказ X');
    expect(html).toContain('№ <!-- -->A-1<!-- --> · ');
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('Долг');
    expect(html).toContain('Срок:');
  });

  it('omits the order-number prefix when orderNumber is null', () => {
    const html = renderToString(
      React.createElement(DealsCardList, { rows: [makeRow({ orderNumber: null })] })
    );
    expect(html).not.toContain('№ <!-- -->');
  });

  it('shows "Без долга" (gray) when debt is 0', () => {
    const html = renderToString(
      React.createElement(DealsCardList, { rows: [makeRow({ debt: '0.00' })] })
    );
    expect(html).toContain('Без долга');
    expect(html).not.toContain('text-red-700 font-medium');
  });

  it('omits the deadline row when deadline is null', () => {
    const html = renderToString(
      React.createElement(DealsCardList, { rows: [makeRow({ deadline: null })] })
    );
    expect(html).not.toContain('Срок:');
  });
});
