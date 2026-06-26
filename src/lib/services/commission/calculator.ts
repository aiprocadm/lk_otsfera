import { Prisma } from '@prisma/client';

/**
 * Commission calculator — money math end-to-end on Prisma.Decimal (decimal.js),
 * never JS `number`. Каждая строка = один платёж (§9.2). База = полная сумма
 * платежа: НДС НЕ вычитается (решение владельца 2026-06-26, перекрывает «без
 * НДС» в §9.2). Возврат (`isRefund`) — отрицательная строка (A2). Все суммы
 * округляются HALF_UP до копейки; итог комиссии = точная сумма уже округлённых
 * строк, затем зажимается в ≥0 (R2: отрицательный нетто-месяц не уходит в
 * выплату; перенос «минуса» — A6/SP-2). A6 (§9.5) здесь НЕ реализован.
 */

export type PaymentForCalc = {
  paymentId: string;
  orderId: string | null;
  orderNumber: string | null;
  organizationName: string;
  amount: Prisma.Decimal;
  isRefund: boolean;
  rate: Prisma.Decimal;
};

export type CalculatorItem = {
  paymentId: string;
  orderId: string | null;
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

const MONEY_SCALE = 2; // kopecks
const RATE_SCALE = 4; // Decimal(6,4)
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const ZERO = new Prisma.Decimal(0);

function toMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(MONEY_SCALE, HALF_UP);
}

export function calculateCommission(payments: PaymentForCalc[]): CalculatorResult {
  const items: CalculatorItem[] = payments.map((p) => {
    const signed = p.isRefund ? p.amount.negated() : p.amount;
    const baseAmount = toMoney(signed);
    const commissionAmount = toMoney(baseAmount.mul(p.rate));
    return {
      paymentId: p.paymentId,
      orderId: p.orderId,
      orderNumber: p.orderNumber,
      organizationName: p.organizationName,
      baseAmount,
      rate: p.rate,
      commissionAmount,
    };
  });

  const totalBaseAmount = items.reduce((sum, i) => sum.plus(i.baseAmount), ZERO);
  const rawCommission = items.reduce((sum, i) => sum.plus(i.commissionAmount), ZERO);
  const totalCommissionAmount = rawCommission.lt(0) ? ZERO : rawCommission;

  const weightedRateSum = items.reduce((sum, i) => sum.plus(i.rate.mul(i.baseAmount)), ZERO);
  const averageRate = totalBaseAmount.gt(0)
    ? weightedRateSum.div(totalBaseAmount).toDecimalPlaces(RATE_SCALE, HALF_UP)
    : ZERO;

  return { items, totals: { totalBaseAmount, totalCommissionAmount, averageRate } };
}
