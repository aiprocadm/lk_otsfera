import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { DealTimeline } from '@/components/partner/deal-timeline';
import type { DealDetail } from '@/lib/services/partner/dealDetail';

function makeDeal(overrides: Partial<DealDetail> = {}): DealDetail {
  return {
    id: 'd1',
    orderNumber: '№1',
    title: 'Заказ',
    stage: { label: 'Новый', tone: 'neutral' },
    executionStatus: 'pending',
    financialStatus: 'not_billed',
    totalAmount: '1000.00',
    paidAmount: '0.00',
    debt: '1000.00',
    vatIncluded: false,
    vatRate: null,
    productMix: [],
    createdAt: new Date('2026-01-01'),
    deadline: null,
    contractSignedAt: null,
    completedAt: null,
    closedAt: null,
    paidAt: null,
    lastSyncedAt: null,
    organization: null,
    managerName: null,
    documents: [],
    comments: [],
    items: [],
    ...overrides
  };
}

describe('DealTimeline', () => {
  it('renders all events greyed-out (not passed) when dates are null', () => {
    const html = renderToString(React.createElement(DealTimeline, { deal: makeDeal() }));
    expect(html).toContain('Создан');
    expect(html).toContain('Договор подписан');
    expect(html).toContain('bg-gray-200');
    expect(html).not.toContain('lastSyncedAt');
  });

  it('marks success-toned passed event (Завершён) green and warning-toned (Дедлайн) orange', () => {
    const deal = makeDeal({ completedAt: new Date('2026-02-01'), deadline: new Date('2026-03-01') });
    const html = renderToString(React.createElement(DealTimeline, { deal }));
    expect(html).toContain('bg-green-500');
    expect(html).toContain('bg-orange-400');
  });

  it('marks a passed event with no explicit tone as neutral grey-400', () => {
    const deal = makeDeal({ closedAt: new Date('2026-04-01') });
    const html = renderToString(React.createElement(DealTimeline, { deal }));
    expect(html).toContain('bg-gray-400');
  });

  it('shows the last-synced-from-1C footer when lastSyncedAt is set', () => {
    const deal = makeDeal({ lastSyncedAt: new Date('2026-05-01T10:00:00Z') });
    const html = renderToString(React.createElement(DealTimeline, { deal }));
    expect(html).toContain('Обновлено из 1С');
  });

  it('omits the footer when lastSyncedAt is null', () => {
    const html = renderToString(React.createElement(DealTimeline, { deal: makeDeal({ lastSyncedAt: null }) }));
    expect(html).not.toContain('Обновлено из 1С');
  });
});
