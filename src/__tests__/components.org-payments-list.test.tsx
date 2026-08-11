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

  it('показывает назначение платежа и № платёжного поручения из выписки', () => {
    // Жалоба 11.08.2026: в карточке заказа видно сумму и дату, а за что
    // платили — нет, хотя назначение приходит вместе с выпиской.
    const payments: OrgOrderPayment[] = [
      {
        id: 'p1',
        amount: '14800.00',
        paidAt: new Date('2026-06-01'),
        method: 'bank',
        isRefund: false,
        note: null,
        purpose: 'ОПЛАТА ПО ДОГОВОРУ 260509-1905 ЗА ОБУЧЕНИЕ. В Т.Ч. НДС (5%) 704-75',
        paymentOrderNumber: '0000-001471',
      },
    ];
    // SSR вставляет комментарии-разделители между текстом и выражением.
    const html = renderToString(React.createElement(OrgPaymentsList, { payments })).replace(
      /<!-- -->/g,
      ''
    );
    expect(html).toContain('ЗА ОБУЧЕНИЕ');
    expect(html).toContain('п/п № 0000-001471');
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
        purpose: null,
        paymentOrderNumber: null,
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
        purpose: null,
        paymentOrderNumber: null,
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
        purpose: null,
        paymentOrderNumber: null,
      },
    ];
    const html = renderToString(React.createElement(OrgPaymentsList, { payments }));
    expect(html).not.toContain('·');
  });
});
