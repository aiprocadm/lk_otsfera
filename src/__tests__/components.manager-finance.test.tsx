import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ManagerFinancePayments } from '@/components/manager/manager-finance-payments';
import type { OrgPaymentRow } from '@/lib/services/organization/finance';

const rows: OrgPaymentRow[] = [
  { id: 'p1', amount: '40.00', paidAt: new Date('2026-04-01'), method: 'wire', isRefund: false, note: null, orderId: 'ord-1', orderNumber: 'A-1' },
  { id: 'p2', amount: '10.00', paidAt: new Date('2026-04-02'), method: null, isRefund: false, note: null, orderId: null, orderNumber: null }
];

describe('ManagerFinancePayments', () => {
  it('links order rows to /manager/orders and renders order number', () => {
    const html = renderToString(<ManagerFinancePayments payments={rows} />);
    expect(html).toContain('/manager/orders/ord-1');
    expect(html).toContain('A-1');
  });

  it('renders org-level payment (null orderId) without a broken link', () => {
    const html = renderToString(<ManagerFinancePayments payments={rows} />);
    expect(html).not.toContain('/manager/orders/null');
  });

  it('renders empty state when no payments', () => {
    const html = renderToString(<ManagerFinancePayments payments={[]} />);
    expect(html).toContain('Платежей пока нет');
  });
});
