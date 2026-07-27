import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrgFinanceCommission } from '@/components/manager/org-finance-commission';
import type { OrgIntermediaryCommission } from '@/lib/services/manager/orgCommission';

describe('OrgFinanceCommission', () => {
  it('renders total, effective rate percentage, and omits the per-order details when empty', () => {
    const data: OrgIntermediaryCommission = { effectiveRate: '0.1', totalCommission: '0.00', perOrder: [] };
    const html = renderToString(React.createElement(OrgFinanceCommission, { data }));
    expect(html).toContain('ставка ');
    expect(html).toContain('10.00');
    expect(html).toContain('%');
    expect(html).not.toContain('<details');
  });

  it('renders the per-order breakdown table when perOrder is non-empty', () => {
    const data: OrgIntermediaryCommission = {
      effectiveRate: '0.15',
      totalCommission: '150.00',
      perOrder: [
        { orderId: 'o1', orderNumber: '55', baseAmount: '1000.00', commissionAmount: '150.00' }
      ]
    };
    const html = renderToString(React.createElement(OrgFinanceCommission, { data }));
    expect(html).toContain('<details');
    expect(html).toContain('55');
    expect(html).toContain('По заказам');
  });

  it('falls back to a dash when orderNumber is null', () => {
    const data: OrgIntermediaryCommission = {
      effectiveRate: '0.15',
      totalCommission: '150.00',
      perOrder: [
        { orderId: 'o2', orderNumber: null, baseAmount: '500.00', commissionAmount: '75.00' }
      ]
    };
    const html = renderToString(React.createElement(OrgFinanceCommission, { data }));
    expect(html).toContain('—');
  });
});
