import { Prisma } from '@prisma/client';
import type { PrismaClient, FinancialStatus } from '@prisma/client';

/**
 * Live-оценка комиссии посредника по организациям (§6.2 ТЗ).
 *
 * Этап 10 (ТЗ §7): модуль вынесен из `services/organization/` — клиентского
 * неймспейса — в staff-контур. Комиссия партнёра клиенту не показывается, а
 * соседство с функциями, которые импортирует страница `/organization/finance`,
 * провоцировало ошибку. Вызывать только из admin/leader-путей.
 */

/** Заказы, считающиеся «выставленными» (те же статусы, что у финансового хаба). */
const BILLED_STATUSES: FinancialStatus[] = ['billed', 'partially_paid', 'paid'];

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
  perOrder: [],
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
    select: {
      id: true,
      partnerCommissionRate: true,
      partner: { select: { commissionRate: true } },
    },
  });
  // Standalone org (no partner) with no org override → no intermediary commission.
  const rateByOrg = new Map<string, Prisma.Decimal>();
  for (const org of orgs) {
    const effectiveRate = org.partnerCommissionRate ?? org.partner?.commissionRate ?? null;
    if (effectiveRate !== null) rateByOrg.set(org.id, effectiveRate);
  }
  if (!rateByOrg.size) return result;

  const orders = await prisma.order.findMany({
    where: {
      organizationId: { in: [...rateByOrg.keys()] },
      financialStatus: { in: BILLED_STATUSES },
    },
    select: { id: true, orderNumber: true, organizationId: true, totalAmount: true },
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
      commissionAmount: commissionAmount.toFixed(2),
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
      perOrder,
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
