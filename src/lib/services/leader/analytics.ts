import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { resolveFunnelStages, stageForLead } from '@/lib/funnel/stages';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { recordAudit } from '@/lib/auth/audit';

/**
 * M3 — аналитика руководителя: когортная конверсия воронки + план/факт по
 * менеджерам (спека docs/superpowers/specs/2026-07-16-m3-leader-analytics-design.md).
 * Result-контракт §3; узкие селекты §13; деньги наружу строками.
 */

function isStaff(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

const OPEN_LEAD_STATUSES = ['new', 'in_review', 'qualified'] as const;

/** Процент num/den, 1 знак после запятой, HALF_UP; 0 при den<=0 (не делим на ноль). */
function pct(numerator: Prisma.Decimal | number, denominator: Prisma.Decimal | number): number {
  const den = denominator instanceof Prisma.Decimal ? denominator : new Prisma.Decimal(denominator);
  if (den.lte(0)) return 0;
  const num = numerator instanceof Prisma.Decimal ? numerator : new Prisma.Decimal(numerator);
  return num.div(den).mul(100).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

function inRange(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

function isValidPeriod(year: number, month: number): boolean {
  return inRange(year, 2000, 2100) && inRange(month, 1, 12);
}

/** [1-е число месяца 00:00, 1-е число следующего месяца) — локаль сервера. */
export function monthRange(year: number, month: number): { from: Date; to: Date } {
  const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const to = new Date(year, month, 1, 0, 0, 0, 0);
  return { from, to };
}

export type StageSnapshot = {
  stageId: string;
  name: string;
  color: string | null;
  count: number;
  /** Decimal-safe sum, string (§3). */
  estimatedSum: string;
};

export type CohortStats = {
  total: number;
  promoted: number;
  rejected: number;
  inWork: number;
  conversionPct: number;
  rejectedPct: number;
  /** null when no promoted lead has a promotedOrder yet. */
  avgDaysToPromote: number | null;
  estimatedTotal: string;
  promotedEstimated: string;
};

export type ManagerFunnelRow = {
  managerId: string | null;
  name: string;
  assigned: number;
  promoted: number;
  rejected: number;
  conversionPct: number;
};

export type GetFunnelAnalyticsResult =
  | { ok: true; snapshot: StageSnapshot[]; cohort: CohortStats; perManager: ManagerFunnelRow[] }
  | { ok: false; error: 'forbidden' };

const UNASSIGNED_LABEL = 'Без менеджера';

/**
 * Воронка руководителя: снапшот открытых стадий (как есть сейчас) + когортная
 * конверсия за период + разбивка по менеджерам. Скоуп C8-partial (спека §0.8):
 * Lead не имеет companyId, поэтому границы держим через assignedManager.companyId,
 * пропуская неназначенные лиды (общая очередь).
 */
export async function getFunnelAnalytics(
  prisma: PrismaClient,
  session: SessionPayload,
  { from, to }: { from: Date; to: Date }
): Promise<GetFunnelAnalyticsResult> {
  if (!isStaff(session) || !session.companyId) return { ok: false, error: 'forbidden' };
  const companyId = session.companyId;

  const scopeOr: Prisma.LeadWhereInput['OR'] = [
    { assignedManagerId: null },
    { assignedManager: { companyId } }
  ];

  const [stages, managers, openLeads, cohortLeads] = await Promise.all([
    resolveFunnelStages(prisma, companyId),
    listCompanyManagers(prisma, companyId),
    prisma.lead.findMany({
      where: { status: { in: [...OPEN_LEAD_STATUSES] }, OR: scopeOr },
      select: { status: true, funnelStageId: true, estimatedAmount: true }
    }),
    prisma.lead.findMany({
      where: { createdAt: { gte: from, lt: to }, OR: scopeOr },
      select: {
        status: true,
        estimatedAmount: true,
        assignedManagerId: true,
        createdAt: true,
        promotedOrder: { select: { createdAt: true } }
      }
    })
  ]);

  // --- snapshot: нетерминальные стадии ---
  const openStages = stages.filter((s) => !s.isTerminal);
  type Bucket = { count: number; sum: Prisma.Decimal };
  const buckets = new Map<string, Bucket>();

  for (const lead of openLeads) {
    const stage = stageForLead(openStages, lead);
    if (!stage) continue; // якорь без открытой стадии (напр. кастомный словарь неполный) — пропускаем
    let bucket = buckets.get(stage.id);
    if (!bucket) {
      bucket = { count: 0, sum: new Prisma.Decimal(0) };
      buckets.set(stage.id, bucket);
    }
    bucket.count += 1;
    if (lead.estimatedAmount !== null) bucket.sum = bucket.sum.plus(lead.estimatedAmount);
  }

  const snapshot: StageSnapshot[] = openStages.map((s) => {
    const bucket = buckets.get(s.id) ?? { count: 0, sum: new Prisma.Decimal(0) };
    return { stageId: s.id, name: s.name, color: s.color, count: bucket.count, estimatedSum: bucket.sum.toFixed(2) };
  });

  // --- cohort: лиды, созданные в периоде ---
  let promoted = 0;
  let rejected = 0;
  let estimatedTotal = new Prisma.Decimal(0);
  let promotedEstimated = new Prisma.Decimal(0);
  let daysSum = 0;
  let daysCount = 0;

  type ManagerAgg = { assigned: number; promoted: number; rejected: number };
  const perManagerAgg = new Map<string, ManagerAgg>();
  const unassignedAgg: ManagerAgg = { assigned: 0, promoted: 0, rejected: 0 };

  for (const lead of cohortLeads) {
    if (lead.estimatedAmount !== null) estimatedTotal = estimatedTotal.plus(lead.estimatedAmount);

    const isPromoted = lead.status === 'promoted_to_order';
    const isRejected = lead.status === 'rejected';

    if (isPromoted) {
      promoted += 1;
      if (lead.estimatedAmount !== null) promotedEstimated = promotedEstimated.plus(lead.estimatedAmount);
      if (lead.promotedOrder) {
        daysSum += (lead.promotedOrder.createdAt.getTime() - lead.createdAt.getTime()) / 86_400_000;
        daysCount += 1;
      }
    } else if (isRejected) {
      rejected += 1;
    }

    const agg = lead.assignedManagerId
      ? (perManagerAgg.get(lead.assignedManagerId) ?? { assigned: 0, promoted: 0, rejected: 0 })
      : unassignedAgg;
    agg.assigned += 1;
    if (isPromoted) agg.promoted += 1;
    if (isRejected) agg.rejected += 1;
    if (lead.assignedManagerId) perManagerAgg.set(lead.assignedManagerId, agg);
  }

  const total = cohortLeads.length;
  const inWork = total - promoted - rejected;

  const cohort: CohortStats = {
    total,
    promoted,
    rejected,
    inWork,
    conversionPct: pct(promoted, total),
    rejectedPct: pct(rejected, total),
    avgDaysToPromote: daysCount > 0 ? Math.round((daysSum / daysCount) * 10) / 10 : null,
    estimatedTotal: estimatedTotal.toFixed(2),
    promotedEstimated: promotedEstimated.toFixed(2)
  };

  const perManager: ManagerFunnelRow[] = managers.map((m) => {
    const agg = perManagerAgg.get(m.id) ?? { assigned: 0, promoted: 0, rejected: 0 };
    return {
      managerId: m.id,
      name: m.name,
      assigned: agg.assigned,
      promoted: agg.promoted,
      rejected: agg.rejected,
      conversionPct: pct(agg.promoted, agg.assigned)
    };
  });
  if (unassignedAgg.assigned > 0) {
    perManager.push({
      managerId: null,
      name: UNASSIGNED_LABEL,
      assigned: unassignedAgg.assigned,
      promoted: unassignedAgg.promoted,
      rejected: unassignedAgg.rejected,
      conversionPct: pct(unassignedAgg.promoted, unassignedAgg.assigned)
    });
  }

  return { ok: true, snapshot, cohort, perManager };
}

export type PlanFactRow = {
  managerId: string | null;
  name: string;
  email: string;
  target: string | null;
  fact: string;
  completedOrders: number;
  executionPct: number | null;
};

export type PlanFactTotals = {
  target: string;
  fact: string;
  executionPct: number | null;
};

export type GetPlanFactResult =
  | { ok: true; rows: PlanFactRow[]; totals: PlanFactTotals }
  | { ok: false; error: 'forbidden' | 'invalid_period' };

/**
 * План/факт руководителя за месяц: факт = нетто-оплаты (Payment.paidAt в
 * границах месяца, isRefund вычитается) заказов компании, сгруппированные по
 * Order.managerId; план = SalesTarget за (year,month); плюс счётчик завершённых
 * заказов месяца. Заказы/оплаты без менеджера — отдельная строка «Без менеджера».
 */
export async function getPlanFact(
  prisma: PrismaClient,
  session: SessionPayload,
  { year, month }: { year: number; month: number }
): Promise<GetPlanFactResult> {
  if (!isStaff(session) || !session.companyId) return { ok: false, error: 'forbidden' };
  if (!isValidPeriod(year, month)) return { ok: false, error: 'invalid_period' };
  const companyId = session.companyId;
  const { from, to } = monthRange(year, month);

  const [managers, payments, completedGroups, targets] = await Promise.all([
    listCompanyManagers(prisma, companyId),
    prisma.payment.findMany({
      where: { paidAt: { gte: from, lt: to }, order: { companyId } },
      select: { amount: true, isRefund: true, order: { select: { managerId: true } } }
    }),
    prisma.order.groupBy({
      by: ['managerId'],
      where: { companyId, completedAt: { gte: from, lt: to } },
      _count: { _all: true }
    }),
    prisma.salesTarget.findMany({
      where: { companyId, year, month },
      select: { managerId: true, targetAmount: true }
    })
  ]);

  const factByManager = new Map<string, Prisma.Decimal>();
  let unassignedFact = new Prisma.Decimal(0);
  for (const p of payments) {
    const amount = new Prisma.Decimal(p.amount);
    const delta = p.isRefund ? amount.negated() : amount;
    const managerId = p.order?.managerId ?? null;
    if (managerId) {
      factByManager.set(managerId, (factByManager.get(managerId) ?? new Prisma.Decimal(0)).plus(delta));
    } else {
      unassignedFact = unassignedFact.plus(delta);
    }
  }

  const completedByManager = new Map<string, number>();
  let unassignedCompleted = 0;
  for (const g of completedGroups) {
    if (g.managerId) completedByManager.set(g.managerId, g._count._all);
    else unassignedCompleted = g._count._all;
  }

  const targetByManager = new Map(targets.map((t) => [t.managerId, t.targetAmount]));

  const rows: PlanFactRow[] = managers.map((m) => {
    const fact = factByManager.get(m.id) ?? new Prisma.Decimal(0);
    const target = targetByManager.get(m.id) ?? null;
    return {
      managerId: m.id,
      name: m.name,
      email: m.email,
      target: target ? target.toFixed(2) : null,
      fact: fact.toFixed(2),
      completedOrders: completedByManager.get(m.id) ?? 0,
      executionPct: target && target.gt(0) ? pct(fact, target) : null
    };
  });

  if (!unassignedFact.isZero() || unassignedCompleted > 0) {
    rows.push({
      managerId: null,
      name: UNASSIGNED_LABEL,
      email: '',
      target: null,
      fact: unassignedFact.toFixed(2),
      completedOrders: unassignedCompleted,
      executionPct: null
    });
  }

  let totalTarget = new Prisma.Decimal(0);
  let totalFact = new Prisma.Decimal(0);
  for (const r of rows) {
    if (r.target) totalTarget = totalTarget.plus(r.target);
    totalFact = totalFact.plus(r.fact);
  }

  const totals: PlanFactTotals = {
    target: totalTarget.toFixed(2),
    fact: totalFact.toFixed(2),
    executionPct: totalTarget.gt(0) ? pct(totalFact, totalTarget) : null
  };

  return { ok: true, rows, totals };
}

const MAX_TARGET_AMOUNT = new Prisma.Decimal('1e12');

export type UpsertSalesTargetArgs = {
  managerId: string;
  year: number;
  month: number;
  /** null = очистить план (удалить строку). */
  targetAmount: string | null;
};

export type UpsertSalesTargetError = 'forbidden' | 'not_found' | 'invalid' | 'invalid_period';

/**
 * Задать/очистить месячный план продаж менеджера. Гард в сервисе (defense-in-
 * depth §4, поверх page/action-гардов): admin ИЛИ leader-менеджер своей
 * компании. Кросс-компания невозможна — целевой менеджер обязан принадлежать
 * session.companyId.
 */
export async function upsertSalesTarget(
  prisma: PrismaClient,
  session: SessionPayload,
  args: UpsertSalesTargetArgs
): Promise<{ ok: true } | { ok: false; error: UpsertSalesTargetError }> {
  const isLeader = session.role === 'admin' || (session.role === 'manager' && session.managerRole === 'leader');
  if (!isLeader || !session.companyId) return { ok: false, error: 'forbidden' };
  const companyId = session.companyId;
  const { managerId, year, month, targetAmount } = args;

  if (!isValidPeriod(year, month)) return { ok: false, error: 'invalid_period' };

  const target = await prisma.user.findUnique({
    where: { id: managerId },
    select: { id: true, role: true, companyId: true }
  });
  if (!target || target.role !== 'manager') return { ok: false, error: 'not_found' };
  if (target.companyId !== companyId) return { ok: false, error: 'forbidden' };

  if (targetAmount === null) {
    await prisma.salesTarget.deleteMany({ where: { companyId, managerId, year, month } });
    await recordAudit(prisma, {
      action: 'sales_target_cleared',
      entity: 'user',
      entityId: managerId,
      userId: session.sub,
      after: { year, month }
    });
    return { ok: true };
  }

  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(targetAmount);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (amount.lte(0) || amount.gte(MAX_TARGET_AMOUNT)) return { ok: false, error: 'invalid' };

  await prisma.salesTarget.upsert({
    where: { companyId_managerId_year_month: { companyId, managerId, year, month } },
    create: { companyId, managerId, year, month, targetAmount: amount, createdById: session.sub },
    update: { targetAmount: amount }
  });

  await recordAudit(prisma, {
    action: 'sales_target_set',
    entity: 'user',
    entityId: managerId,
    userId: session.sub,
    after: { year, month, targetAmount: amount.toFixed(2) }
  });

  return { ok: true };
}
