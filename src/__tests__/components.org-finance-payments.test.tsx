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

import { OrgFinancePayments } from '@/components/organization/org-finance-payments';
import type { OrgPaymentRow } from '@/lib/services/organization/finance';

function basePayment(overrides: Partial<OrgPaymentRow> = {}): OrgPaymentRow {
  return {
    id: 'p1',
    amount: '500.00',
    paidAt: new Date('2026-01-10'),
    method: 'wire',
    isRefund: false,
    note: null,
    orderId: 'o1',
    orderNumber: '10',
    vatAmount: '100.00',
    purpose: 'Оплата курса',
    paymentOrderNumber: '555',
    enteredByName: 'Иванов',
    ...overrides,
  };
}

describe('OrgFinancePayments', () => {
  it('renders the empty state when there are no payments', () => {
    const html = renderToString(
      React.createElement(OrgFinancePayments, { payments: [], orgId: 'org1' })
    );
    expect(html).toContain('Платежей пока нет.');
  });

  it('renders a full payment row with order link, method, vat and entered-by', () => {
    const html = renderToString(
      React.createElement(OrgFinancePayments, { payments: [basePayment()], orgId: 'org1' })
    );
    expect(html).toContain('href="/organization/orders/o1?org=org1"');
    expect(html).toContain('10');
    expect(html).toContain('Банковский перевод');
    expect(html).toContain('Оплата курса');
    expect(html).toContain('555');
    expect(html).toContain('100');
    expect(html).toContain('Иванов');
  });

  it('renders refund styling and hides order link when orderId is null', () => {
    const html = renderToString(
      React.createElement(OrgFinancePayments, {
        payments: [basePayment({ orderId: null, orderNumber: null, isRefund: true })],
        orgId: 'org1',
      })
    );
    expect(html).toContain('Возврат');
    expect(html).toContain('text-red-600');
  });

  it('falls back to a dash for the order number when orderId is present but orderNumber is null', () => {
    const html = renderToString(
      React.createElement(OrgFinancePayments, {
        payments: [basePayment({ orderNumber: null })],
        orgId: 'org1',
      })
    );
    expect(html).toContain('href="/organization/orders/o1?org=org1"');
  });

  it('renders dashes when vatAmount and purpose and paymentOrderNumber and enteredByName are null', () => {
    const html = renderToString(
      React.createElement(OrgFinancePayments, {
        payments: [
          basePayment({
            vatAmount: null,
            purpose: null,
            paymentOrderNumber: null,
            enteredByName: null,
          }),
        ],
        orgId: 'org1',
      })
    );
    expect(html).toContain('—');
  });
});
