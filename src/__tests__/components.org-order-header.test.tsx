import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrgOrderHeader } from '@/components/organization/org-order-header';
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
    paidAmount: '0.00',
    debt: '1000.00',
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
    ...overrides,
  } as OrgOrderDetail;
}

describe('OrgOrderHeader', () => {
  it('renders order number, title, and manager block when both present', () => {
    const order = baseOrder({ orderNumber: '77', managerName: 'Иванов И.И.' });
    const html = renderToString(React.createElement(OrgOrderHeader, { order }));
    expect(html).toContain('font-mono">№');
    expect(html).toContain('77');
    expect(html).toContain('Заказ 1');
    expect(html).toContain('Иванов И.И.');
    expect(html).toContain('Менеджер');
  });

  it('omits order number and manager block when absent', () => {
    const order = baseOrder({ orderNumber: null, managerName: null });
    const html = renderToString(React.createElement(OrgOrderHeader, { order }));
    expect(html).not.toContain('№ ');
    expect(html).not.toContain('Менеджер');
  });

  it('renders product mix tags when present', () => {
    const order = baseOrder({ productMix: ['Курс А', 'Курс Б'] });
    const html = renderToString(React.createElement(OrgOrderHeader, { order }));
    expect(html).toContain('Курс А');
    expect(html).toContain('Курс Б');
  });

  it('omits product mix block when empty', () => {
    const order = baseOrder({ productMix: [] });
    const html = renderToString(React.createElement(OrgOrderHeader, { order }));
    expect(html).not.toContain('Курс А');
  });

  it('renders a single terminal badge for a cancelled order (stepper terminal branch)', () => {
    const order = baseOrder({ executionStatus: 'cancelled' });
    const html = renderToString(React.createElement(OrgOrderHeader, { order }));
    expect(html).toContain('Отменён');
  });

  it('renders the multi-step stepper for a non-terminal order', () => {
    const order = baseOrder({
      executionStatus: 'in_progress',
      contractSignedAt: new Date('2026-01-02'),
    });
    const html = renderToString(React.createElement(OrgOrderHeader, { order }));
    expect(html).toContain('<ol');
  });
});
