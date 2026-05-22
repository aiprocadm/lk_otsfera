export type OrderForCalc = {
  id: string;
  orderNumber: string | null;
  organizationName: string;
  totalAmount: number;
  vatIncluded: boolean;
  vatRate: number | null;
  rate: number;
};

export type CalculatorItem = {
  orderId: string;
  orderNumber: string | null;
  organizationName: string;
  baseAmount: number;
  rate: number;
  commissionAmount: number;
};

export type CalculatorTotals = {
  totalBaseAmount: number;
  totalCommissionAmount: number;
  averageRate: number;
};

export type CalculatorResult = {
  items: CalculatorItem[];
  totals: CalculatorTotals;
};

export type CalculatorOptions = {
  vatMode?: 'full' | 'exclude_vat';
};

const DEFAULT_VAT_RATE = 0.2;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function baseAmountFor(order: OrderForCalc, vatMode: 'full' | 'exclude_vat'): number {
  if (vatMode === 'full') return order.totalAmount;
  if (!order.vatIncluded) return order.totalAmount;
  const vatRate = order.vatRate ?? DEFAULT_VAT_RATE;
  return order.totalAmount / (1 + vatRate);
}

export function calculateCommission(
  orders: OrderForCalc[],
  opts: CalculatorOptions = {}
): CalculatorResult {
  const vatMode = opts.vatMode ?? 'full';

  const items: CalculatorItem[] = orders.map((o) => {
    const baseAmount = round2(baseAmountFor(o, vatMode));
    const commissionAmount = round2(baseAmount * o.rate);
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      organizationName: o.organizationName,
      baseAmount,
      rate: o.rate,
      commissionAmount
    };
  });

  const totalBaseAmount = round2(items.reduce((s, i) => s + i.baseAmount, 0));
  const totalCommissionAmount = round2(items.reduce((s, i) => s + i.commissionAmount, 0));
  const weightedRateSum = items.reduce((s, i) => s + i.rate * i.baseAmount, 0);
  const averageRate = totalBaseAmount > 0 ? round4(weightedRateSum / totalBaseAmount) : 0;

  return {
    items,
    totals: { totalBaseAmount, totalCommissionAmount, averageRate }
  };
}
