import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { kpiMetric } from '@/lib/kpi/metrics';
import { parseKpiMonth } from '@/lib/kpi/period';
import { moscowMonthRange } from '@/lib/dates/calendar';

// ExecutionStatus enum: pending | in_progress | completed | cancelled | on_hold
// Active = открытые в работе заказы; terminal = закрытые (для overdue-фильтра).
const ACTIVE_EXEC = ['pending', 'in_progress'] as const;
const TERMINAL_EXEC = ['completed', 'cancelled'] as const;

type LeaderKpis = {
  managers: number;
  activeOrders: number;
  /** Decimal sums serialized as strings (service contract §3). */
  debt: string;
  /** null when no commission on any org (member-level field-gate upstream). */
  commission: string | null;
  /**
   * `У-345`: оплаты по заказам компании за текущий московский месяц, возвраты
   * вычтены. Тот же показатель, что «Оплачено» в «Аналитике» (`revenue_paid`) —
   * одна цифра из одного расчёта, а не своя сумма на каждом экране (`Д-63`).
   */
  paidThisMonth: string;
  /** `У-345`: комиссия посредников, выплаченная в этом месяце (оплаченные ведомости). */
  commissionPaidThisMonth: string;
};

export type LeaderManagerRow = {
  managerId: string;
  name: string;
  email: string;
  /** active orders only (executionStatus in pending|in_progress) */
  activeOrders: number;
  totalAmount: string;
  paidAmount: string;
  /** orders past deadline and not terminal (completed/cancelled) */
  overdue: number;
};

export type LeaderDashboard = {
  kpis: LeaderKpis;
  perManager: LeaderManagerRow[];
};

const EMPTY: LeaderDashboard = {
  kpis: {
    managers: 0,
    activeOrders: 0,
    debt: '0.00',
    commission: null,
    paidThisMonth: '0.00',
    commissionPaidThisMonth: '0.00',
  },
  perManager: [],
};

/**
 * «Сводка по команде» руководителя. Company-wide ВСЕГДА (инвариант C8: граница —
 * компания; toggle managerTeamVisibility на кабинет руководителя не влияет, поэтому
 * финансовая витрина зовётся с teamMode:true). Финансовые агрегаты + расчёт комиссии
 * (с field-gate) живут в getManagerFinanceOverview — здесь только сборка KPI и
 * per-manager-разбивки по заказам компании.
 *
 * Read-агрегатор: возвращает простую форму (как manager/dashboard), не Result.
 * Decimal-суммы сериализуются строками (§3).
 */
export async function leaderDashboard(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<LeaderDashboard> {
  const companyId = session.companyId;
  if (!companyId) {
    return EMPTY;
  }

  const now = new Date();
  const activeWhere: Prisma.OrderWhereInput = {
    companyId,
    executionStatus: { in: [...ACTIVE_EXEC] },
  };

  const { year, month } = parseKpiMonth(undefined);
  const monthRange = moscowMonthRange(year, month);

  const [managers, activeOrders, activeGroup, overdueGroup, finance, paid, commissionPaid] =
    await Promise.all([
      listCompanyManagers(prisma, companyId),
      prisma.order.count({ where: activeWhere }),
      prisma.order.groupBy({
        by: ['managerId'],
        where: activeWhere,
        _count: { _all: true },
        _sum: { totalAmount: true, paidAmount: true },
      }),
      prisma.order.groupBy({
        by: ['managerId'],
        where: {
          companyId,
          deadline: { lt: now },
          executionStatus: { notIn: [...TERMINAL_EXEC] },
        },
        _count: { _all: true },
      }),
      // R1.2: дашборду нужны только summary.outstanding и commission-итоги —
      // ledger платежей (top-50 на каждую организацию) не тянем.
      getManagerFinanceOverview(prisma, session, { teamMode: true, includePayments: false }),
      kpiMetric('revenue_paid').compute(prisma, { companyId, ...monthRange }),
      commissionPaidInRange(prisma, companyId, monthRange),
    ]);

  const aggBy = new Map(activeGroup.map((g) => [g.managerId, g]));
  const overdueBy = new Map(overdueGroup.map((g) => [g.managerId, g._count._all]));

  // NB: per-manager rows are roster-driven (one row per company manager), so an
  // active order with managerId=null (unassigned) lands in NO row — it's counted
  // in the company-wide kpis.activeOrders but not in any perManager.activeOrders.
  // Therefore sum(perManager.activeOrders) ≤ kpis.activeOrders by design.
  //
  // F6 (resolved, owner decision 2026-06-14): perManager money columns are the value
  // of *active work* (executionStatus axis), while kpis.debt is outstanding on *billed*
  // orders (financialStatus axis). The two are DIFFERENT metrics on purpose and do NOT
  // reconcile — do not "unify the filter" to make them add up; that would gut the team-
  // workload signal. The UI labels the divergence (leader/dashboard page caption).
  const perManager: LeaderManagerRow[] = managers.map((m) => {
    const agg = aggBy.get(m.id);
    return {
      managerId: m.id,
      name: m.name,
      email: m.email,
      activeOrders: agg?._count._all ?? 0,
      totalAmount: new Prisma.Decimal(agg?._sum.totalAmount ?? 0).toFixed(2),
      paidAmount: new Prisma.Decimal(agg?._sum.paidAmount ?? 0).toFixed(2),
      overdue: overdueBy.get(m.id) ?? 0,
    };
  });

  // Decimal-safe sum (no float drift, matching commission/calculator.ts).
  let commissionTotal = new Prisma.Decimal(0);
  let hasCommission = false;
  for (const s of finance.sections) {
    if (s.commission) {
      hasCommission = true;
      commissionTotal = commissionTotal.plus(s.commission.totalCommission);
    }
  }

  return {
    kpis: {
      managers: managers.length,
      activeOrders,
      debt: finance.summary.outstanding,
      commission: hasCommission ? commissionTotal.toFixed(2) : null,
      paidThisMonth: paid.total,
      commissionPaidThisMonth: commissionPaid,
    },
    perManager,
  };
}

/**
 * Комиссия посредников, выплаченная за период: строки ведомостей со статусом
 * `paid` и датой выплаты в периоде. У ведомости своей компании нет (она
 * партнёрская, а партнёр работает с организациями разных компаний), поэтому
 * компания берётся у строки — через её заказ, платёж или корректировку
 * (корректировка привязана к возврату-платежу). Строки чужой компании в ту же
 * ведомость не попадают в сумму руководителя (C8).
 */
async function commissionPaidInRange(
  prisma: PrismaClient,
  companyId: string,
  range: { from: Date; to: Date }
): Promise<string> {
  const agg = await prisma.commissionStatementItem.aggregate({
    where: {
      statement: { status: 'paid', paidAt: { gte: range.from, lt: range.to } },
      OR: [
        { order: { companyId } },
        { payment: { order: { companyId } } },
        { correction: { payment: { order: { companyId } } } },
      ],
    },
    _sum: { commissionAmount: true },
  });
  return new Prisma.Decimal(agg._sum.commissionAmount ?? 0).toFixed(2);
}
