import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ManagerOrderAmounts } from '@/components/manager/manager-order-amounts';
import type { ManagerOrderDetail } from '@/lib/services/manager/orders';

function makeOrder(overrides: Partial<ManagerOrderDetail>): ManagerOrderDetail {
  return {
    totalAmount: '1000' as unknown as ManagerOrderDetail['totalAmount'],
    paidAmount: '400' as unknown as ManagerOrderDetail['paidAmount'],
    vatRate: '0.2' as unknown as ManagerOrderDetail['vatRate'],
    vatIncluded: true,
    ...overrides
  } as ManagerOrderDetail;
}

describe('ManagerOrderAmounts', () => {
  it('renders total, paid, debt tiles with money formatting', () => {
    const order = makeOrder({});
    const html = renderToString(React.createElement(ManagerOrderAmounts, { order }));
    expect(html).toContain('Сумма');
    expect(html).toContain('Оплачено');
    expect(html).toContain('Долг');
    expect(html).toContain('₽');
  });

  it('debt > 0: danger tone applied', () => {
    const order = makeOrder({ totalAmount: '1000' as unknown as ManagerOrderDetail['totalAmount'], paidAmount: '400' as unknown as ManagerOrderDetail['paidAmount'] });
    const html = renderToString(React.createElement(ManagerOrderAmounts, { order }));
    expect(html).toContain('bg-red-50 border-red-100 text-red-800');
  });

  it('debt === 0 (fully paid): neutral tone, not danger', () => {
    const order = makeOrder({ totalAmount: '1000' as unknown as ManagerOrderDetail['totalAmount'], paidAmount: '1000' as unknown as ManagerOrderDetail['paidAmount'] });
    const html = renderToString(React.createElement(ManagerOrderAmounts, { order }));
    expect(html).not.toContain('bg-red-50 border-red-100 text-red-800');
  });

  it('renders the progress bar and percentage when total > 0', () => {
    const order = makeOrder({ totalAmount: '1000' as unknown as ManagerOrderDetail['totalAmount'], paidAmount: '500' as unknown as ManagerOrderDetail['paidAmount'] });
    const html = renderToString(React.createElement(ManagerOrderAmounts, { order }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('50%');
  });

  it('paidPct is clamped to 100 when paid exceeds total', () => {
    const order = makeOrder({ totalAmount: '1000' as unknown as ManagerOrderDetail['totalAmount'], paidAmount: '2000' as unknown as ManagerOrderDetail['paidAmount'] });
    const html = renderToString(React.createElement(ManagerOrderAmounts, { order }));
    expect(html).toContain('100%');
  });

  it('total === 0: no progress bar section rendered', () => {
    const order = makeOrder({ totalAmount: '0' as unknown as ManagerOrderDetail['totalAmount'], paidAmount: '0' as unknown as ManagerOrderDetail['paidAmount'] });
    const html = renderToString(React.createElement(ManagerOrderAmounts, { order }));
    expect(html).not.toContain('role="progressbar"');
  });

  it('vatIncluded=true renders "НДС включён"', () => {
    const order = makeOrder({ vatIncluded: true, vatRate: '0.2' as unknown as ManagerOrderDetail['vatRate'] });
    const html = renderToString(React.createElement(ManagerOrderAmounts, { order }));
    expect(html).toContain('НДС включён');
    expect(html).toContain('ставка <!-- -->20<!-- -->%');
  });

  it('vatIncluded=false renders "Без НДС"', () => {
    const order = makeOrder({ vatIncluded: false, vatRate: null });
    const html = renderToString(React.createElement(ManagerOrderAmounts, { order }));
    expect(html).toContain('Без НДС');
  });

  it('vatRate === null omits the ставка suffix', () => {
    const order = makeOrder({ vatRate: null });
    const html = renderToString(React.createElement(ManagerOrderAmounts, { order }));
    expect(html).not.toContain('ставка');
  });
});
