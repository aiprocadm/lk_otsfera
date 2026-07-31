import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrgOrderTimeline } from '@/components/organization/org-order-timeline';
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

describe('OrgOrderTimeline', () => {
  it('renders all dashes and no green/orange dots when all dates are null', () => {
    const html = renderToString(React.createElement(OrgOrderTimeline, { order: baseOrder() }));
    expect(html).toContain('Создан');
    expect(html).toContain('—');
    expect(html).not.toContain('bg-green-500');
    expect(html).not.toContain('bg-orange-400');
    expect(html).not.toContain('Обновлено из 1С');
  });

  it('renders warning tone for a passed deadline and success tone for completed/paid', () => {
    const order = baseOrder({
      deadline: new Date('2026-02-01'),
      completedAt: new Date('2026-02-02'),
      paidAt: new Date('2026-02-03'),
      contractSignedAt: new Date('2026-01-15'),
      closedAt: new Date('2026-02-04'),
    });
    const html = renderToString(React.createElement(OrgOrderTimeline, { order }));
    expect(html).toContain('bg-orange-400');
    expect(html).toContain('bg-green-500');
  });

  it('renders neutral (gray-400) dot for a passed date with no tone (e.g. Закрыт)', () => {
    const order = baseOrder({ closedAt: new Date('2026-02-04') });
    const html = renderToString(React.createElement(OrgOrderTimeline, { order }));
    expect(html).toContain('bg-gray-400');
  });

  it('renders the 1C sync footer when lastSyncedAt is set', () => {
    const order = baseOrder({ lastSyncedAt: new Date('2026-02-05T10:30:00') });
    const html = renderToString(React.createElement(OrgOrderTimeline, { order }));
    expect(html).toContain('Обновлено из 1С');
  });
});
