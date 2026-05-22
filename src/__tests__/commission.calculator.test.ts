import { describe, expect, it } from 'vitest';
import { calculateCommission, type OrderForCalc } from '@/lib/services/commission/calculator';

function order(overrides: Partial<OrderForCalc> = {}): OrderForCalc {
  return {
    id: 'o1',
    orderNumber: 'ORD-1',
    organizationName: 'Org A',
    totalAmount: 100000,
    vatIncluded: true,
    vatRate: 0.2,
    rate: 0.1,
    ...overrides
  };
}

describe('calculateCommission', () => {
  it('returns zero totals for empty order list', () => {
    const result = calculateCommission([]);
    expect(result.items).toEqual([]);
    expect(result.totals.totalBaseAmount).toBe(0);
    expect(result.totals.totalCommissionAmount).toBe(0);
    expect(result.totals.averageRate).toBe(0);
  });

  it('computes one order at default vatMode=full', () => {
    const result = calculateCommission([order({ totalAmount: 100000, rate: 0.1 })]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].baseAmount).toBe(100000);
    expect(result.items[0].rate).toBe(0.1);
    expect(result.items[0].commissionAmount).toBe(10000);
    expect(result.totals.totalBaseAmount).toBe(100000);
    expect(result.totals.totalCommissionAmount).toBe(10000);
    expect(result.totals.averageRate).toBe(0.1);
  });

  it('computes weighted average rate across mixed-rate orders', () => {
    const result = calculateCommission([
      order({ id: 'a', totalAmount: 100000, rate: 0.1 }),
      order({ id: 'b', totalAmount: 300000, rate: 0.05 })
    ]);
    expect(result.items).toHaveLength(2);
    expect(result.totals.totalBaseAmount).toBe(400000);
    expect(result.totals.totalCommissionAmount).toBe(10000 + 15000);
    expect(result.totals.averageRate).toBeCloseTo((0.1 * 100000 + 0.05 * 300000) / 400000, 6);
  });

  it('vatMode=exclude_vat removes VAT from baseAmount when vatIncluded', () => {
    const result = calculateCommission(
      [order({ totalAmount: 120000, vatIncluded: true, vatRate: 0.2, rate: 0.1 })],
      { vatMode: 'exclude_vat' }
    );
    // 120000 with vatIncluded=true and vatRate=0.2 → net = 120000 / 1.2 = 100000
    expect(result.items[0].baseAmount).toBe(100000);
    expect(result.items[0].commissionAmount).toBe(10000);
  });

  it('vatMode=exclude_vat with vatIncluded=false keeps baseAmount as-is', () => {
    const result = calculateCommission(
      [order({ totalAmount: 100000, vatIncluded: false, vatRate: 0.2, rate: 0.1 })],
      { vatMode: 'exclude_vat' }
    );
    expect(result.items[0].baseAmount).toBe(100000);
    expect(result.items[0].commissionAmount).toBe(10000);
  });

  it('vatMode=exclude_vat with null vatRate uses default 0.2', () => {
    const result = calculateCommission(
      [order({ totalAmount: 120000, vatIncluded: true, vatRate: null, rate: 0.1 })],
      { vatMode: 'exclude_vat' }
    );
    expect(result.items[0].baseAmount).toBe(100000);
  });

  it('rounds commissionAmount to 2 decimals', () => {
    const result = calculateCommission([
      order({ totalAmount: 12345.67, rate: 0.123 })
    ]);
    // 12345.67 * 0.123 = 1518.51741 → 1518.52
    expect(result.items[0].commissionAmount).toBe(1518.52);
  });

  it('zero totalAmount produces zero commission and does not divide by zero', () => {
    const result = calculateCommission([
      order({ totalAmount: 0, rate: 0.1 })
    ]);
    expect(result.items[0].commissionAmount).toBe(0);
    expect(result.totals.totalBaseAmount).toBe(0);
    expect(result.totals.averageRate).toBe(0);
  });

  it('preserves orderNumber and organizationName in items', () => {
    const result = calculateCommission([
      order({ orderNumber: 'ORD-42', organizationName: 'Acme LLC' })
    ]);
    expect(result.items[0].orderNumber).toBe('ORD-42');
    expect(result.items[0].organizationName).toBe('Acme LLC');
  });

  it('preserves orderId for downstream FK on CommissionStatementItem', () => {
    const result = calculateCommission([order({ id: 'order-uuid-7' })]);
    expect(result.items[0].orderId).toBe('order-uuid-7');
  });
});
