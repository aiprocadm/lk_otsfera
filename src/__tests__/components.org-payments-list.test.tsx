import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrgPaymentsList } from '@/components/organization/org-payments-list';
import type { OrgOrderPayment } from '@/lib/services/organization/orders';

describe('OrgPaymentsList', () => {
  it('renders the empty message and omits the count badge when there are no payments', () => {
    const html = renderToString(React.createElement(OrgPaymentsList, { payments: [] }));
    expect(html).toContain('Оплат по заказу пока нет.');
    expect(html).not.toContain('(0)');
  });

  it('renders count badge, method label, and note for a regular payment', () => {
    const payments: OrgOrderPayment[] = [
      {
        id: 'p1',
        amount: '500.00',
        paidAt: new Date('2026-01-10'),
        method: 'bank',
        isRefund: false,
        note: 'Аванс',
      },
    ];
    const html = renderToString(React.createElement(OrgPaymentsList, { payments }));
    expect(html).toContain('>1<');
    expect(html).toContain('Банковский перевод');
    expect(html).toContain('Аванс');
    expect(html).not.toContain('Возврат');
  });

  it('renders refund styling and badge, and falls back to the raw method when unknown', () => {
    const payments: OrgOrderPayment[] = [
      {
        id: 'p2',
        amount: '100.00',
        paidAt: new Date('2026-01-11'),
        method: 'crypto',
        isRefund: true,
        note: null,
      },
    ];
    const html = renderToString(React.createElement(OrgPaymentsList, { payments }));
    expect(html).toContain('Возврат');
    expect(html).toContain('crypto');
  });

  it('omits the method segment entirely when method is null', () => {
    const payments: OrgOrderPayment[] = [
      {
        id: 'p3',
        amount: '200.00',
        paidAt: new Date('2026-01-12'),
        method: null,
        isRefund: false,
        note: null,
      },
    ];
    const html = renderToString(React.createElement(OrgPaymentsList, { payments }));
    expect(html).not.toContain('·');
  });
});
