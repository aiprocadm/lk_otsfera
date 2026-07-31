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
    organizationIds.map((id) => [
      id,
      { billed: new Prisma.Decimal(0), paid: new Prisma.Decimal(0) },
    ])
  );
  if (organizationIds.length) {
    const orders = await prisma.order.findMany({
      where: { organizationId: { in: organizationIds }, financialStatus: { in: BILLED_STATUSES } },
      select: { organizationId: true, totalAmount: true, paidAmount: true },
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
        outstanding: a.billed.minus(a.paid).toFixed(2),
      },
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
      order: { select: { id: true, orderNumber: true } },
    },
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
    enteredByName: p.enteredBy?.name ?? null,
  }));
}

/**
 * Выгрузка леджера платежей (этап 9 PR-3, ФТ-12.2): та же выборка, что у
 * экрана, но до `limit` строк + `total` для хвоста «показаны первые N из M».
 */
export async function listOrgPaymentsForExport(
  prisma: PrismaClient,
  opts: { organizationId: string; limit: number }
): Promise<{ rows: OrgPaymentRow[]; total: number }> {
  const [rows, total] = await Promise.all([
    listOrgPayments(prisma, { organizationId: opts.organizationId, take: opts.limit }),
    prisma.payment.count({ where: { organizationId: opts.organizationId } }),
  ]);
  return { rows, total };
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
      enteredByName: r.enteredByName,
    });
  }
  return result;
}
