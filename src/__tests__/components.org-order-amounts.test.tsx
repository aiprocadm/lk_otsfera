import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrgOrderAmounts } from '@/components/organization/org-order-amounts';
import type { OrgOrderDetail } from '@/lib/services/organization/orders';

function baseOrder(overrides: Partial<OrgOrderDetail> = {}): OrgOrderDetail {
  return {
    id: 'o1',
    organizationId: 'org1',
    orderNumber: '100',
    title: 'Заказ 1',
    stage: { label: 'В работе', tone: 'neutral' },
    executionStatus: 'in_progress',
    financialStatus: 'billed',
    totalAmount: '1000.00',
    paidAmount: '500.00',
    debt: '500.00',
    vatIncluded: true,
    vatRate: '0.2',
    productMix: [],
    createdAt: new Date('2026-01-01'),
    deadline: null,
    contractSignedAt: null,
    completedAt: null,
    closedAt: null,
    paidAt: null,
    lastSyncedAt: null,
    managerName: null,
    payments: [],
    commentsCount: 0,
    items: [],
    ...overrides
  } as OrgOrderDetail;
}

describe('OrgOrderAmounts', () => {
  it('renders totals and a danger-toned debt tile when debt > 0', () => {
    const html = renderToString(React.createElement(OrgOrderAmounts, { order: baseOrder() }));
    expect(html).toContain('1 000');
    expect(html).toContain('text-red-800');
    expect(html).toContain('50%');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="50"');
  });

  it('renders neutral-toned debt tile when debt is 0', () => {
    const order = baseOrder({ totalAmount: '500.00', paidAmount: '500.00', debt: '0.00' });
    const html = renderToString(React.createElement(OrgOrderAmounts, { order }));
    expect(html).toContain('100%');
    expect(html).not.toContain('text-red-800');
  });

  it('omits the progress bar block when total is 0', () => {
    const order = baseOrder({ totalAmount: '0.00', paidAmount: '0.00', debt: '0.00' });
    const html = renderToString(React.createElement(OrgOrderAmounts, { order }));
    expect(html).not.toContain('role="progressbar"');
  });

  it('shows "Без НДС" and omits rate when vatIncluded is false and vatRate is null', () => {
    const order = baseOrder({ vatIncluded: false, vatRate: null });
    const html = renderToString(React.createElement(OrgOrderAmounts, { order }));
    expect(html).toContain('Без НДС');
    expect(html).not.toContain('ставка');
  });

  it('shows vat rate percentage when vatRate is set', () => {
    const order = baseOrder({ vatIncluded: true, vatRate: '0.20' });
    const html = renderToString(React.createElement(OrgOrderAmounts, { order }));
    expect(html).toContain('НДС включён');
    expect(html).toContain('ставка ');
    expect(html).toContain('20');
    expect(html).toContain('%');
  });
});
