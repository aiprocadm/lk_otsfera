import { Prisma } from '@prisma/client';
import type { PrismaClient, FinancialStatus } from '@prisma/client';

/**
 * Orders considered "billed at all" for the finance hub. `not_billed` and
 * `refunded` are excluded from the KPI/commission aggregates; refunds remain
 * visible as individual rows in the payment ledger.
 */
const BILLED_STATUSES: FinancialStatus[] = ['billed', 'partially_paid', 'paid'];

export type OrgFinanceKpis = { billed: string; paid: string; outstanding: string };

export async function getOrgFinanceKpis(
  prisma: PrismaClient,
  organizationId: string
): Promise<OrgFinanceKpis> {
  const orders = await prisma.order.findMany({
    where: { organizationId, financialStatus: { in: BILLED_STATUSES } },
    select: { totalAmount: true, paidAmount: true }
  });
  let billed = 0;
  let paid = 0;
  for (const o of orders) {
    billed += Number(o.totalAmount);
    paid += Number(o.paidAmount);
  }
  return { billed: billed.toFixed(2), paid: paid.toFixed(2), outstanding: (billed - paid).toFixed(2) };
}

export type OrgPaymentRow = {
  id: string;
  amount: string;
  paidAt: Date;
  method: string | null;
  isRefund: boolean;
  note: string | null;
  orderId: string | null;
  orderNumber: string | null;
  vatAmount: string | null;
  purpose: string | null;
  paymentOrderNumber: string | null;
  enteredByName: string | null;
};

export async function listOrgPayments(
  prisma: PrismaClient,
  opts: { organizationId: string; take?: number }
): Promise<OrgPaymentRow[]> {
  const rows = await prisma.payment.findMany({
    where: { organizationId: opts.organizationId },
    orderBy: { paidAt: 'desc' },
    take: opts.take ?? 50,
    select: {
      id: true,
      amount: true,
      paidAt: true,
      method: true,
      isRefund: true,
      note: true,
      vatAmount: true,
      purpose: true,
      paymentOrderNumber: true,
      enteredBy: { select: { name: true } },
      order: { select: { id: true, orderNumber: true } }
    }
  });
  return rows.map((p) => ({
    id: p.id,
    amount: p.amount.toFixed(2),
    paidAt: p.paidAt,
    method: p.method,
    isRefund: p.isRefund,
    note: p.note,
    orderId: p.order?.id ?? null,
    orderNumber: p.order?.orderNumber ?? null,
    vatAmount: p.vatAmount != null ? p.vatAmount.toFixed(2) : null,
    purpose: p.purpose ?? null,
    paymentOrderNumber: p.paymentOrderNumber ?? null,
    enteredByName: p.enteredBy?.name ?? null
  }));
}

export type OrgCommissionOrderRow = {
  orderId: string;
  orderNumber: string | null;
  baseAmount: string;
  commissionAmount: string;
};
export type OrgIntermediaryCommission = {
  effectiveRate: string;
  totalCommission: string;
  perOrder: OrgCommissionOrderRow[];
};

/**
 * Live estimate of the intermediary (partner) commission on this organization's
 * orders: effectiveRate × base per order, reusing the canonical calculator.
 * effectiveRate = org override ?? partner default. Sensitive — callers MUST gate
 * this to admin/leader (see canSeeIntermediaryCommission); a member never reaches it.
 */
export async function getOrgIntermediaryCommission(
  prisma: PrismaClient,
  organizationId: string
): Promise<OrgIntermediaryCommission> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, partnerCommissionRate: true, partner: { select: { commissionRate: true } } }
  });
  if (!org) return { effectiveRate: '0', totalCommission: '0.00', perOrder: [] };

  // Standalone org (no partner) with no org override → no intermediary commission.
  const effectiveRate =
    org.partnerCommissionRate ?? org.partner?.commissionRate ?? null;
  if (effectiveRate === null) {
    return { effectiveRate: '0', totalCommission: '0.00', perOrder: [] };
  }
  const orders = await prisma.order.findMany({
    where: { organizationId, financialStatus: { in: BILLED_STATUSES } },
    select: { id: true, orderNumber: true, totalAmount: true }
  });

  // Live estimate (NOT the partner statement): base = order total, commission =
  // base × effectiveRate. Deliberately order-based and override-aware — it stays
  // a forward-looking estimate for the org finance hub. The canonical partner
  // statement moved to a payment-based calculator (§9.2); this estimate did not.
  const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
  const toMoney = (v: Prisma.Decimal) => v.toDecimalPlaces(2, HALF_UP);

  const perOrder = orders.map((o) => {
    const baseAmount = toMoney(o.totalAmount);
    const commissionAmount = toMoney(baseAmount.mul(effectiveRate));
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      baseAmount: baseAmount.toFixed(2),
      commissionAmount: commissionAmount.toFixed(2)
    };
  });
  const totalCommission = perOrder.reduce(
    (sum, i) => sum.plus(new Prisma.Decimal(i.commissionAmount)),
    new Prisma.Decimal(0)
  );

  return {
    effectiveRate: effectiveRate.toString(),
    totalCommission: totalCommission.toFixed(2),
    perOrder
  };
}
