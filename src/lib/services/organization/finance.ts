import { Prisma } from '@prisma/client';
import type { PrismaClient, FinancialStatus } from '@prisma/client';

/**
 * Orders considered "billed at all" for the finance hub. `not_billed` and
 * `refunded` are excluded from the KPI/commission aggregates; refunds remain
 * visible as individual rows in the payment ledger.
 */
const BILLED_STATUSES: FinancialStatus[] = ['billed', 'partially_paid', 'paid'];

export type OrgFinanceKpis = { billed: string; paid: string; outstanding: string };

/**
 * Батч-вариант для витрин менеджера/руководителя (N организаций → 1 запрос
 * вместо N). Каждому запрошенному id гарантированно соответствует запись
 * (нулевые KPI при отсутствии заказов). Деньги — на Decimal (канон §1 ТЗ).
 */
export async function getOrgFinanceKpisForOrgs(
  prisma: PrismaClient,
  organizationIds: string[]
): Promise<Map<string, OrgFinanceKpis>> {
  const acc = new Map<string, { billed: Prisma.Decimal; paid: Prisma.Decimal }>(
    organizationIds.map((id) => [id, { billed: new Prisma.Decimal(0), paid: new Prisma.Decimal(0) }])
  );
  if (organizationIds.length) {
    const orders = await prisma.order.findMany({
      where: { organizationId: { in: organizationIds }, financialStatus: { in: BILLED_STATUSES } },
      select: { organizationId: true, totalAmount: true, paidAmount: true }
    });
    for (const o of orders) {
      const a = acc.get(o.organizationId)!;
      a.billed = a.billed.plus(o.totalAmount);
      a.paid = a.paid.plus(o.paidAmount);
    }
  }
  return new Map(
    [...acc].map(([id, a]) => [
      id,
      {
        billed: a.billed.toFixed(2),
        paid: a.paid.toFixed(2),
        outstanding: a.billed.minus(a.paid).toFixed(2)
      }
    ])
  );
}

export async function getOrgFinanceKpis(
  prisma: PrismaClient,
  organizationId: string
): Promise<OrgFinanceKpis> {
  const map = await getOrgFinanceKpisForOrgs(prisma, [organizationId]);
  // Батч сидит запись для каждого запрошенного id — get() не бывает undefined.
  return map.get(organizationId)!;
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

type RawOrgPaymentRow = {
  id: string;
  organizationId: string;
  amount: Prisma.Decimal;
  paidAt: Date;
  method: string | null;
  isRefund: boolean;
  note: string | null;
  vatAmount: Prisma.Decimal | null;
  purpose: string | null;
  paymentOrderNumber: string | null;
  orderId: string | null;
  orderNumber: string | null;
  enteredByName: string | null;
};

/**
 * Батч-вариант леджера платежей: top-`perOrgTake` на КАЖДУЮ организацию одним
 * оконным запросом (ROW_NUMBER) вместо N запросов. Каждому запрошенному id
 * соответствует запись (пустой массив при отсутствии платежей). Формат строк
 * идентичен listOrgPayments.
 */
export async function listOrgPaymentsForOrgs(
  prisma: PrismaClient,
  organizationIds: string[],
  perOrgTake = 50
): Promise<Map<string, OrgPaymentRow[]>> {
  const result = new Map<string, OrgPaymentRow[]>(organizationIds.map((id) => [id, []]));
  if (!organizationIds.length) return result;

  const rows = await prisma.$queryRaw<RawOrgPaymentRow[]>`
    SELECT
      p."id", p."organizationId", p."amount", p."paidAt", p."method", p."isRefund",
      p."note", p."vatAmount", p."purpose", p."paymentOrderNumber",
      o."id" AS "orderId", o."orderNumber",
      u."name" AS "enteredByName"
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "paidAt" DESC) AS rn
      FROM "Payment"
      WHERE "organizationId" IN (${Prisma.join(organizationIds)})
    ) p
    LEFT JOIN "Order" o ON o."id" = p."orderId"
    LEFT JOIN "User" u ON u."id" = p."enteredById"
    WHERE p.rn <= ${perOrgTake}
    ORDER BY p."organizationId", p."paidAt" DESC
  `;

  for (const r of rows) {
    result.get(r.organizationId)!.push({
      id: r.id,
      amount: r.amount.toFixed(2),
      paidAt: r.paidAt,
      method: r.method,
      isRefund: r.isRefund,
      note: r.note,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      vatAmount: r.vatAmount != null ? r.vatAmount.toFixed(2) : null,
      purpose: r.purpose,
      paymentOrderNumber: r.paymentOrderNumber,
      enteredByName: r.enteredByName
    });
  }
  return result;
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

const emptyCommission = (): OrgIntermediaryCommission => ({
  effectiveRate: '0',
  totalCommission: '0.00',
  perOrder: []
});

/**
 * Батч-вариант live-оценки комиссии посредника (N организаций → 2 запроса
 * вместо 2N). Семантика и округление идентичны одиночному варианту; каждому
 * запрошенному id соответствует запись (empty при отсутствии org/ставки).
 * Sensitive — callers MUST gate this to admin/leader.
 */
export async function getOrgIntermediaryCommissionForOrgs(
  prisma: PrismaClient,
  organizationIds: string[]
): Promise<Map<string, OrgIntermediaryCommission>> {
  const result = new Map<string, OrgIntermediaryCommission>(
    organizationIds.map((id) => [id, emptyCommission()])
  );
  if (!organizationIds.length) return result;

  const orgs = await prisma.organization.findMany({
    where: { id: { in: organizationIds } },
    select: { id: true, partnerCommissionRate: true, partner: { select: { commissionRate: true } } }
  });
  // Standalone org (no partner) with no org override → no intermediary commission.
  const rateByOrg = new Map<string, Prisma.Decimal>();
  for (const org of orgs) {
    const effectiveRate = org.partnerCommissionRate ?? org.partner?.commissionRate ?? null;
    if (effectiveRate !== null) rateByOrg.set(org.id, effectiveRate);
  }
  if (!rateByOrg.size) return result;

  const orders = await prisma.order.findMany({
    where: { organizationId: { in: [...rateByOrg.keys()] }, financialStatus: { in: BILLED_STATUSES } },
    select: { id: true, orderNumber: true, organizationId: true, totalAmount: true }
  });

  // Live estimate (NOT the partner statement): base = order total, commission =
  // base × effectiveRate. Deliberately order-based and override-aware — it stays
  // a forward-looking estimate for the org finance hub. The canonical partner
  // statement moved to a payment-based calculator (§9.2); this estimate did not.
  const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
  const toMoney = (v: Prisma.Decimal) => v.toDecimalPlaces(2, HALF_UP);

  const perOrderByOrg = new Map<string, OrgCommissionOrderRow[]>();
  for (const o of orders) {
    const effectiveRate = rateByOrg.get(o.organizationId)!;
    const baseAmount = toMoney(o.totalAmount);
    const commissionAmount = toMoney(baseAmount.mul(effectiveRate));
    const rows = perOrderByOrg.get(o.organizationId) ?? [];
    rows.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      baseAmount: baseAmount.toFixed(2),
      commissionAmount: commissionAmount.toFixed(2)
    });
    perOrderByOrg.set(o.organizationId, rows);
  }

  for (const [orgId, effectiveRate] of rateByOrg) {
    const perOrder = perOrderByOrg.get(orgId) ?? [];
    const totalCommission = perOrder.reduce(
      (sum, i) => sum.plus(new Prisma.Decimal(i.commissionAmount)),
      new Prisma.Decimal(0)
    );
    result.set(orgId, {
      effectiveRate: effectiveRate.toString(),
      totalCommission: totalCommission.toFixed(2),
      perOrder
    });
  }
  return result;
}

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
  const map = await getOrgIntermediaryCommissionForOrgs(prisma, [organizationId]);
  // Батч сидит запись для каждого запрошенного id — get() не бывает undefined.
  return map.get(organizationId)!;
}
