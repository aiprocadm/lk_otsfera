import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { calculateCommission, type PaymentForCalc, type CorrectionForCalc } from '@/lib/services/commission/calculator';

function payment(overrides: Partial<{
  paymentId: string; orderId: string | null; orderNumber: string | null;
  organizationName: string; amount: number | string; isRefund: boolean; rate: number | string;
}> = {}): PaymentForCalc {
  return {
    paymentId: overrides.paymentId ?? 'pay1',
    orderId: overrides.orderId === undefined ? 'o1' : overrides.orderId,
    orderNumber: overrides.orderNumber === undefined ? 'ORD-1' : overrides.orderNumber,
    organizationName: overrides.organizationName ?? 'Org A',
    amount: new Prisma.Decimal(overrides.amount ?? 100000),
    isRefund: overrides.isRefund ?? false,
    rate: new Prisma.Decimal(overrides.rate ?? 0.2),
  };
}

describe('calculateCommission (payment-based)', () => {
  it('returns zero totals for empty list', () => {
    const r = calculateCommission([]);
    expect(r.items).toEqual([]);
    expect(r.totals.totalBaseAmount.toNumber()).toBe(0);
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(0);
    expect(r.totals.averageRate.toNumber()).toBe(0);
  });

  it('A1/R0: base = full payment amount, VAT never subtracted (100000 × 20% = 20000)', () => {
    const r = calculateCommission([payment({ amount: 100000, rate: 0.2 })]);
    expect(r.items[0].baseAmount.toNumber()).toBe(100000);
    expect(r.items[0].commissionAmount.toNumber()).toBe(20000);
    expect(r.totals.totalBaseAmount.toNumber()).toBe(100000);
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(20000);
  });

  it('A1: partial payment counted at its actual amount', () => {
    const r = calculateCommission([payment({ amount: 40000, rate: 0.1 })]);
    expect(r.items[0].baseAmount.toNumber()).toBe(40000);
    expect(r.items[0].commissionAmount.toNumber()).toBe(4000);
  });

  it('A1: several payments on one order produce several lines', () => {
    const r = calculateCommission([
      payment({ paymentId: 'p1', orderId: 'o9', amount: 30000, rate: 0.1 }),
      payment({ paymentId: 'p2', orderId: 'o9', amount: 70000, rate: 0.1 }),
    ]);
    expect(r.items).toHaveLength(2);
    expect(r.totals.totalBaseAmount.toNumber()).toBe(100000);
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(10000);
  });

  it('A2: refund is a negative line and reduces the base', () => {
    const r = calculateCommission([
      payment({ paymentId: 'p1', amount: 100000, rate: 0.1 }),
      payment({ paymentId: 'p2', amount: 30000, rate: 0.1, isRefund: true }),
    ]);
    expect(r.items[1].baseAmount.toNumber()).toBe(-30000);
    expect(r.items[1].commissionAmount.toNumber()).toBe(-3000);
    expect(r.totals.totalBaseAmount.toNumber()).toBe(70000);
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(7000);
  });

  it('A2/R2: negative net month clamps total commission to 0 but keeps negative lines', () => {
    const r = calculateCommission([
      payment({ paymentId: 'p1', amount: 10000, rate: 0.1 }),
      payment({ paymentId: 'p2', amount: 50000, rate: 0.1, isRefund: true }),
    ]);
    expect(r.totals.totalBaseAmount.toNumber()).toBe(-40000);
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(0);
    expect(r.items).toHaveLength(2);
    expect(r.items[1].commissionAmount.toNumber()).toBe(-5000);
  });

  it('order-less payment keeps orderId null and computes on full amount', () => {
    const r = calculateCommission([payment({ orderId: null, orderNumber: null, amount: 50000, rate: 0.1 })]);
    expect(r.items[0].orderId).toBeNull();
    expect(r.items[0].commissionAmount.toNumber()).toBe(5000);
  });

  it('exposes paymentId on the item', () => {
    const r = calculateCommission([payment({ paymentId: 'pay-uuid-7' })]);
    expect(r.items[0].paymentId).toBe('pay-uuid-7');
  });

  it('rounds each commission half-up with exact arithmetic (20.70 × 5% = 1.035 → 1.04)', () => {
    const r = calculateCommission([payment({ amount: 20.7, rate: 0.05 })]);
    expect(r.items[0].commissionAmount.toFixed(2)).toBe('1.04');
    expect(r.totals.totalCommissionAmount.toFixed(2)).toBe('1.04');
  });

  it('total equals the exact sum of the rounded line amounts (no re-round drift)', () => {
    const r = calculateCommission([
      payment({ paymentId: 'a', amount: 20.7, rate: 0.05 }),
      payment({ paymentId: 'b', amount: 20.7, rate: 0.05 }),
      payment({ paymentId: 'c', amount: 20.7, rate: 0.05 }),
    ]);
    expect(r.totals.totalCommissionAmount.toFixed(2)).toBe('3.12');
  });

  it('weighted average rate across mixed-rate payments', () => {
    const r = calculateCommission([
      payment({ paymentId: 'a', amount: 100000, rate: 0.1 }),
      payment({ paymentId: 'b', amount: 300000, rate: 0.05 }),
    ]);
    expect(r.totals.averageRate.toNumber()).toBeCloseTo((0.1 * 100000 + 0.05 * 300000) / 400000, 6);
  });

  function correction(over: Partial<{
    correctionId: string;
    organizationName: string;
    baseAmount: number | string;
    rate: number | string;
    commissionAmount: number | string;
  }> = {}): CorrectionForCalc {
    return {
      correctionId: over.correctionId ?? 'c1',
      organizationName: over.organizationName ?? 'Корректировка §9.5',
      baseAmount: new Prisma.Decimal(over.baseAmount ?? -30000),
      rate: new Prisma.Decimal(over.rate ?? 0.2),
      commissionAmount: new Prisma.Decimal(over.commissionAmount ?? -6000),
    };
  }

  it('A6: correction lines fold into items and reduce total commission', () => {
    const r = calculateCommission(
      [payment({ amount: 100000, rate: 0.2 })],
      [correction({ baseAmount: -30000, commissionAmount: -6000 })]
    );
    expect(r.items).toHaveLength(2);
    const corr = r.items.find((i) => i.correctionId === 'c1')!;
    expect(corr.paymentId).toBeNull();
    expect(corr.orderId).toBeNull();
    expect(corr.commissionAmount.toNumber()).toBe(-6000);
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(14000);
  });

  it('A6/R2: corrections exceeding payments clamp total to 0 (lines kept)', () => {
    const r = calculateCommission(
      [payment({ amount: 10000, rate: 0.1 })],
      [correction({ baseAmount: -50000, commissionAmount: -5000 })]
    );
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(0);
    expect(r.items).toHaveLength(2);
  });

  it('A6: uses pre-computed commissionAmount, not amount×rate (chain remainder with rate 0)', () => {
    const r = calculateCommission(
      [],
      [correction({ correctionId: 'chain', rate: 0, baseAmount: -4000, commissionAmount: -4000 })]
    );
    expect(r.items[0].commissionAmount.toNumber()).toBe(-4000);
  });

  it('correction-only with no payments → clamped 0 total', () => {
    const r = calculateCommission([], [correction({ commissionAmount: -6000 })]);
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(0);
  });
});
