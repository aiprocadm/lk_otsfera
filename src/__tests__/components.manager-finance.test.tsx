import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { ManagerFinancePayments } from '@/components/manager/manager-finance-payments';
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';
import { OrgFinancePayments } from '@/components/organization/org-finance-payments';
import type { OrgPaymentRow } from '@/lib/services/organization/finance';
import type { ManagerFinanceOverview } from '@/lib/services/manager/finance';

const rows: OrgPaymentRow[] = [
  {
    id: 'p1',
    amount: '40.00',
    paidAt: new Date('2026-04-01'),
    method: 'wire',
    isRefund: false,
    note: null,
    orderId: 'ord-1',
    orderNumber: 'A-1',
    vatAmount: '6.00',
    purpose: 'Аванс',
    paymentOrderNumber: 'ПП-1',
    enteredByName: null,
  },
  {
    id: 'p2',
    amount: '10.00',
    paidAt: new Date('2026-04-02'),
    method: null,
    isRefund: false,
    note: null,
    orderId: null,
    orderNumber: null,
    vatAmount: null,
    purpose: null,
    paymentOrderNumber: null,
    enteredByName: null,
  },
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

  it('respects basePath for the order link (admin → /admin/orders)', () => {
    const html = renderToString(<ManagerFinancePayments payments={rows} basePath="/admin" />);
    expect(html).toContain('/admin/orders/ord-1');
    expect(html).not.toContain('/manager/orders/ord-1');
  });

  it('respects basePath for the order link (leader → /leader/orders)', () => {
    const html = renderToString(<ManagerFinancePayments payments={rows} basePath="/leader" />);
    expect(html).toContain('/leader/orders/ord-1');
  });

  it('order-linked row with a null orderNumber renders the — fallback inside the link', () => {
    const withNullNumber: OrgPaymentRow[] = [{ ...rows[0]!, orderNumber: null }];
    const html = renderToString(<ManagerFinancePayments payments={withNullNumber} />);
    expect(html).toContain('/manager/orders/ord-1');
    expect(html).toContain('—');
  });

  it('refund row: red "Возврат" label (not the payment method) and a minus-prefixed red amount', () => {
    const refundRow: OrgPaymentRow[] = [{ ...rows[0]!, isRefund: true }];
    const html = renderToString(<ManagerFinancePayments payments={refundRow} />);
    expect(html).toContain('text-red-600">Возврат');
    expect(html).toContain('text-red-600');
    expect(html).toContain('−');
  });

  it('non-refund row: renders the payment method label, not "Возврат"', () => {
    const html = renderToString(<ManagerFinancePayments payments={rows} />);
    expect(html).not.toContain('>Возврат<');
  });
});

describe('OrgFinancePayments', () => {
  it('links order rows to /organization/orders carrying the active ?org=', () => {
    const html = renderToString(<OrgFinancePayments payments={rows} orgId="org-9" />);
    expect(html).toContain('/organization/orders/ord-1?org=org-9');
  });

  it('renders empty state when no payments', () => {
    const html = renderToString(<OrgFinancePayments payments={[]} orgId="org-9" />);
    expect(html).toContain('Платежей пока нет');
  });
});

const baseSection = {
  orgId: 'o1',
  orgName: 'ООО Ромашка',
  kpis: { billed: '100.00', paid: '40.00', outstanding: '60.00' },
  payments: rows,
  commission: null as ManagerFinanceOverview['sections'][number]['commission'],
};

describe('ManagerFinanceView', () => {
  const overview: ManagerFinanceOverview = {
    summary: { billed: '100.00', paid: '40.00', outstanding: '60.00' },
    sections: [baseSection],
    canSeeCommission: false,
  };

  it('renders org name and summary', () => {
    const html = renderToString(<ManagerFinanceView data={overview} />);
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('Выставлено');
  });

  it('hides commission block when section.commission is null', () => {
    const html = renderToString(<ManagerFinanceView data={overview} />);
    expect(html).not.toContain('Комиссия посредника');
  });

  it('shows commission block when section.commission is present', () => {
    const withCommission: ManagerFinanceOverview = {
      ...overview,
      canSeeCommission: true,
      sections: [
        {
          ...baseSection,
          commission: { effectiveRate: '0.1', totalCommission: '10.00', perOrder: [] },
        },
      ],
    };
    const html = renderToString(<ManagerFinanceView data={withCommission} />);
    expect(html).toContain('Комиссия посредника');
  });

  it('рядовой менеджер (commission=null) не видит блок комиссии', () => {
    const html = renderToString(
      React.createElement(ManagerFinanceView, {
        data: {
          summary: { billed: '100', paid: '0', outstanding: '100' },
          sections: [
            {
              orgId: 'o1',
              orgName: 'Орг',
              kpis: { billed: '100', paid: '0', outstanding: '100' },
              payments: [],
              commission: null,
            },
          ],
          canSeeCommission: false,
        },
      })
    );
    expect(html).not.toContain('Комиссия');
  });

  it('threads ordersBasePath down to the payment rows', () => {
    const html = renderToString(<ManagerFinanceView data={overview} ordersBasePath="/admin" />);
    expect(html).toContain('/admin/orders/ord-1');
    expect(html).not.toContain('/manager/orders/ord-1');
  });

  it('renders empty state when no sections', () => {
    const empty: ManagerFinanceOverview = {
      summary: { billed: '0.00', paid: '0.00', outstanding: '0.00' },
      sections: [],
      canSeeCommission: false,
    };
    const html = renderToString(<ManagerFinanceView data={empty} />);
    expect(html).toContain('Нет организаций');
  });
});
