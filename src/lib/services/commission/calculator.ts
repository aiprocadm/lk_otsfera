import { Prisma } from '@prisma/client';

/**
 * Commission calculator — money math is done end-to-end on Prisma.Decimal
 * (decimal.js), never JS `number`. Coercing Decimal→number loses precision and
 * `Math.round(n*100)/100` mis-rounds exact `.xx5` boundaries (e.g. 20.70 × 5% =
 * 1.035 silently became 1.03). All amounts are rounded HALF_UP to kopeck scale,
 * and each statement total is the *exact sum of the already-rounded line
 * amounts* so the document stays internally consistent (lines add up to total).
 */

export type OrderForCalc = {
  id: string;
  orderNumber: string | null;
  organizationName: string;
  totalAmount: Prisma.Decimal;
  vatIncluded: boolean;
  vatRate: Prisma.Decimal | null;
  rate: Prisma.Decimal;
};

export type CalculatorItem = {
  orderId: string;
  orderNumber: string | null;
  organizationName: string;
  baseAmount: Prisma.Decimal;
  rate: Prisma.Decimal;
  commissionAmount: Prisma.Decimal;
};

export type CalculatorTotals = {
  totalBaseAmount: Prisma.Decimal;
  totalCommissionAmount: Prisma.Decimal;
  averageRate: Prisma.Decimal;
};

export type CalculatorResult = {
  items: CalculatorItem[];
  totals: CalculatorTotals;
};

export type CalculatorOptions = {
  vatMode?: 'full' | 'exclude_vat';
};

const DEFAULT_VAT_RATE = new Prisma.Decimal('0.2');
const MONEY_SCALE = 2; // kopecks
const RATE_SCALE = 4; // commission rate precision (Decimal(6,4) in schema)
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const ZERO = new Prisma.Decimal(0);

function toMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(MONEY_SCALE, HALF_UP);
}

function baseAmountFor(order: OrderForCalc, vatMode: 'full' | 'exclude_vat'): Prisma.Decimal {
  if (vatMode === 'full' || !order.vatIncluded) return order.totalAmount;
  const vatRate = order.vatRate ?? DEFAULT_VAT_RATE;
  return order.totalAmount.div(new Prisma.Decimal(1).plus(vatRate));
}

export function calculateCommission(
  orders: OrderForCalc[],
  opts: CalculatorOptions = {}
): CalculatorResult {
  const vatMode = opts.vatMode ?? 'full';

  const items: CalculatorItem[] = orders.map((o) => {
    const baseAmount = toMoney(baseAmountFor(o, vatMode));
    const commissionAmount = toMoney(baseAmount.mul(o.rate));
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      organizationName: o.organizationName,
      baseAmount,
      rate: o.rate,
      commissionAmount
    };
  });

  // Totals are the exact sum of the already-rounded line amounts (each line is a
  // payable kopeck amount), so Σ lines === total by construction — no re-round,
  // no float drift.
  const totalBaseAmount = items.reduce((sum, i) => sum.plus(i.baseAmount), ZERO);
  const totalCommissionAmount = items.reduce((sum, i) => sum.plus(i.commissionAmount), ZERO);
  const weightedRateSum = items.reduce((sum, i) => sum.plus(i.rate.mul(i.baseAmount)), ZERO);
  const averageRate = totalBaseAmount.gt(0)
    ? weightedRateSum.div(totalBaseAmount).toDecimalPlaces(RATE_SCALE, HALF_UP)
    : ZERO;

  return {
    items,
    totals: { totalBaseAmount, totalCommissionAmount, averageRate }
  };
}
