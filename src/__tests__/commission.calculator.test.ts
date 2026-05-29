import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { calculateCommission, type OrderForCalc } from '@/lib/services/commission/calculator';

function order(
  overrides: {
    id?: string;
    orderNumber?: string | null;
    organizationName?: string;
    totalAmount?: number | string;
    vatIncluded?: boolean;
    vatRate?: number | string | null;
    rate?: number | string;
  } = {}
): OrderForCalc {
  return {
    id: overrides.id ?? 'o1',
    orderNumber: overrides.orderNumber === undefined ? 'ORD-1' : overrides.orderNumber,
    organizationName: overrides.organizationName ?? 'Org A',
    totalAmount: new Prisma.Decimal(overrides.totalAmount ?? 100000),
    vatIncluded: overrides.vatIncluded ?? true,
    vatRate: overrides.vatRate === null ? null : new Prisma.Decimal(overrides.vatRate ?? 0.2),
    rate: new Prisma.Decimal(overrides.rate ?? 0.1)
  };
}

describe('calculateCommission', () => {
  it('returns zero totals for empty order list', () => {
    const result = calculateCommission([]);
    expect(result.items).toEqual([]);
    expect(result.totals.totalBaseAmount.toNumber()).toBe(0);
    expect(result.totals.totalCommissionAmount.toNumber()).toBe(0);
    expect(result.totals.averageRate.toNumber()).toBe(0);
  });

  it('computes one order at default vatMode=full', () => {
    const result = calculateCommission([order({ totalAmount: 100000, rate: 0.1 })]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].baseAmount.toNumber()).toBe(100000);
    expect(result.items[0].rate.toNumber()).toBe(0.1);
    expect(result.items[0].commissionAmount.toNumber()).toBe(10000);
    expect(result.totals.totalBaseAmount.toNumber()).toBe(100000);
    expect(result.totals.totalCommissionAmount.toNumber()).toBe(10000);
    expect(result.totals.averageRate.toNumber()).toBe(0.1);
  });

  it('computes weighted average rate across mixed-rate orders', () => {
    const result = calculateCommission([
      order({ id: 'a', totalAmount: 100000, rate: 0.1 }),
      order({ id: 'b', totalAmount: 300000, rate: 0.05 })
    ]);
    expect(result.items).toHaveLength(2);
    expect(result.totals.totalBaseAmount.toNumber()).toBe(400000);
    expect(result.totals.totalCommissionAmount.toNumber()).toBe(10000 + 15000);
    expect(result.totals.averageRate.toNumber()).toBeCloseTo((0.1 * 100000 + 0.05 * 300000) / 400000, 6);
  });

  it('vatMode=exclude_vat removes VAT from baseAmount when vatIncluded', () => {
    const result = calculateCommission(
      [order({ totalAmount: 120000, vatIncluded: true, vatRate: 0.2, rate: 0.1 })],
      { vatMode: 'exclude_vat' }
    );
    // 120000 with vatIncluded=true and vatRate=0.2 → net = 120000 / 1.2 = 100000
    expect(result.items[0].baseAmount.toNumber()).toBe(100000);
    expect(result.items[0].commissionAmount.toNumber()).toBe(10000);
  });

  it('vatMode=exclude_vat with vatIncluded=false keeps baseAmount as-is', () => {
    const result = calculateCommission(
      [order({ totalAmount: 100000, vatIncluded: false, vatRate: 0.2, rate: 0.1 })],
      { vatMode: 'exclude_vat' }
    );
    expect(result.items[0].baseAmount.toNumber()).toBe(100000);
    expect(result.items[0].commissionAmount.toNumber()).toBe(10000);
  });

  it('vatMode=exclude_vat with null vatRate uses default 0.2', () => {
    const result = calculateCommission(
      [order({ totalAmount: 120000, vatIncluded: true, vatRate: null, rate: 0.1 })],
      { vatMode: 'exclude_vat' }
    );
    expect(result.items[0].baseAmount.toNumber()).toBe(100000);
  });

  it('rounds commissionAmount to 2 decimals', () => {
    const result = calculateCommission([order({ totalAmount: 12345.67, rate: 0.123 })]);
    // 12345.67 * 0.123 = 1518.51741 → 1518.52
    expect(result.items[0].commissionAmount.toNumber()).toBe(1518.52);
  });

  it('zero totalAmount produces zero commission and does not divide by zero', () => {
    const result = calculateCommission([order({ totalAmount: 0, rate: 0.1 })]);
    expect(result.items[0].commissionAmount.toNumber()).toBe(0);
    expect(result.totals.totalBaseAmount.toNumber()).toBe(0);
    expect(result.totals.averageRate.toNumber()).toBe(0);
  });

  it('preserves orderNumber and organizationName in items', () => {
    const result = calculateCommission([order({ orderNumber: 'ORD-42', organizationName: 'Acme LLC' })]);
    expect(result.items[0].orderNumber).toBe('ORD-42');
    expect(result.items[0].organizationName).toBe('Acme LLC');
  });

  it('preserves orderId for downstream FK on CommissionStatementItem', () => {
    const result = calculateCommission([order({ id: 'order-uuid-7' })]);
    expect(result.items[0].orderId).toBe('order-uuid-7');
  });

  it('rounds each commission half-up with exact arithmetic (20.70 × 5% = 1.035 → 1.04, not float 1.03)', () => {
    const result = calculateCommission([order({ totalAmount: 20.7, rate: 0.05 })]);
    // Float path: Math.round(20.70 * 0.05 * 100) / 100 = 1.03 (the product is 1.0349999…).
    // Exact half-up of 1.035 is 1.04. The total equals the sum of the rounded lines.
    expect(result.items[0].commissionAmount.toFixed(2)).toBe('1.04');
    expect(result.totals.totalCommissionAmount.toFixed(2)).toBe('1.04');
  });

  it('keeps the statement total equal to the exact sum of the rounded line amounts', () => {
    // Three identical 1.035 lines: each rounds to 1.04, so the total is 3.12 (not
    // a re-rounded 3.105 → 3.11). Exact Decimal addition, no float drift.
    const result = calculateCommission([
      order({ id: 'a', totalAmount: 20.7, rate: 0.05 }),
      order({ id: 'b', totalAmount: 20.7, rate: 0.05 }),
      order({ id: 'c', totalAmount: 20.7, rate: 0.05 })
    ]);
    expect(result.items.map((i) => i.commissionAmount.toFixed(2))).toEqual(['1.04', '1.04', '1.04']);
    expect(result.totals.totalCommissionAmount.toFixed(2)).toBe('3.12');
  });
});
