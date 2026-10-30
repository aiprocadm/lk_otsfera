import { Prisma } from '@prisma/client';
import type { PrismaClient, FinancialStatus } from '@prisma/client';
import type { OrgOrderScope } from '@/lib/auth/organizationPolicy';

/**
 * Orders considered "billed at all" for the finance hub. `not_billed` and
 * `refunded` are excluded from the KPI/commission aggregates; refunds remain
 * visible as individual rows in the payment ledger.
 */
/**
 * Заказы, по которым счёт выставлен (оплачен он или нет). `У-329`: тот же набор
 * задаёт и строки «счёт по заказу» в списке счетов заказчика — источник один.
 */
export const BILLED_STATUSES: FinancialStatus[] = ['billed', 'partially_paid', 'paid'];

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

/**
 * `У-236`: при включённой настройке участник видит деньги только своих заказов.
 * Без границы (`scope = null`) считает батч-вариант, как раньше; с границей —
 * свой узкий запрос, потому что батч обслуживает витрины сотрудников сразу по
 * многим организациям и границы зрителя не знает.
 */
export async function getOrgFinanceKpis(
  prisma: PrismaClient,
  organizationId: string,
  scope: OrgOrderScope
): Promise<OrgFinanceKpis> {
  if (!scope) {
    const map = await getOrgFinanceKpisForOrgs(prisma, [organizationId]);
    // Батч сидит запись для каждого запрошенного id — get() не бывает undefined.
    return map.get(organizationId)!;
  }
  const orders = await prisma.order.findMany({
    where: { organizationId, financialStatus: { in: BILLED_STATUSES }, ...scope.where },
    select: { totalAmount: true, paidAmount: true },
  });
  let billed = new Prisma.Decimal(0);
  let paid = new Prisma.Decimal(0);
  for (const o of orders) {
    billed = billed.plus(o.totalAmount);
    paid = paid.plus(o.paidAmount);
  }
  return {
    billed: billed.toFixed(2),
    paid: paid.toFixed(2),
    outstanding: billed.minus(paid).toFixed(2),
  };
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
  opts: { organizationId: string; take?: number; scope: OrgOrderScope }
): Promise<OrgPaymentRow[]> {
  const rows = await prisma.payment.findMany({
    // `У-236`: платёж показывает номер и сумму заказа, поэтому граница зрителя
    // действует и здесь. Платёж без заказа «своим» быть не может — фильтр по
    // связи его тоже отсекает.
    where: {
      organizationId: opts.organizationId,
      ...(opts.scope ? { order: opts.scope.where } : {}),
    },
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
  opts: { organizationId: string; limit: number; scope: OrgOrderScope }
): Promise<{ rows: OrgPaymentRow[]; total: number }> {
  const [rows, total] = await Promise.all([
    listOrgPayments(prisma, {
      organizationId: opts.organizationId,
      take: opts.limit,
      scope: opts.scope,
    }),
    // Фильтр повторён внутри вызова намеренно: вынесенный в переменную, он не
    // виден стражу — а хвост «показаны первые N из M» обязан считать то же.
    prisma.payment.count({
      where: {
        organizationId: opts.organizationId,
        ...(opts.scope ? { order: opts.scope.where } : {}),
      },
    }),
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
