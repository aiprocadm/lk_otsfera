import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { DealAmounts } from '@/components/partner/deal-amounts';
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

describe('DealAmounts', () => {
  it('renders total/paid/debt tiles with danger tone when debt > 0', () => {
    const html = renderToString(React.createElement(DealAmounts, { deal: makeDeal() }));
    expect(html).toContain('1 000');
    expect(html).toContain('bg-red-50');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="0"');
  });

  it('renders neutral debt tone when debt is 0', () => {
    const deal = makeDeal({ totalAmount: '1000.00', paidAmount: '1000.00', debt: '0.00' });
    const html = renderToString(React.createElement(DealAmounts, { deal }));
    expect(html).toContain('aria-valuenow="100"');
    expect(html).not.toContain('bg-red-50');
  });

  it('omits the progress bar when totalAmount is 0', () => {
    const deal = makeDeal({ totalAmount: '0.00', paidAmount: '0.00', debt: '0.00' });
    const html = renderToString(React.createElement(DealAmounts, { deal }));
    expect(html).not.toContain('role="progressbar"');
  });

  it('shows "Без НДС" when vatIncluded is false', () => {
    const html = renderToString(React.createElement(DealAmounts, { deal: makeDeal({ vatIncluded: false, vatRate: null }) }));
    expect(html).toContain('Без НДС');
  });

  it('shows "НДС включён" with rate when vatIncluded is true and vatRate is set', () => {
    const deal = makeDeal({ vatIncluded: true, vatRate: '0.2' });
    const html = renderToString(React.createElement(DealAmounts, { deal }));
    expect(html).toContain('НДС включён');
    expect(html).toContain('ставка <!-- -->20<!-- -->%');
  });
});
