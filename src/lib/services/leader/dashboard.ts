import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { listCompanyManagers } from '@/lib/services/manager/team';

// ExecutionStatus enum: pending | in_progress | completed | cancelled | on_hold
// Active = открытые в работе заказы; terminal = закрытые (для overdue-фильтра).
const ACTIVE_EXEC = ['pending', 'in_progress'] as const;
const TERMINAL_EXEC = ['completed', 'cancelled'] as const;

export type LeaderKpis = {
  managers: number;
  activeOrders: number;
  /** Decimal sums serialized as strings (service contract §3). */
  debt: string;
  /** null when no commission on any org (member-level field-gate upstream). */
  commission: string | null;
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
  kpis: { managers: 0, activeOrders: 0, debt: '0.00', commission: null },
  perManager: []
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
    executionStatus: { in: [...ACTIVE_EXEC] }
  };

  const [managers, activeOrders, activeGroup, overdueGroup, finance] = await Promise.all([
    listCompanyManagers(prisma, companyId),
    prisma.order.count({ where: activeWhere }),
    prisma.order.groupBy({
      by: ['managerId'],
      where: activeWhere,
      _count: { _all: true },
      _sum: { totalAmount: true, paidAmount: true }
    }),
    prisma.order.groupBy({
      by: ['managerId'],
      where: {
        companyId,
        deadline: { lt: now },
        executionStatus: { notIn: [...TERMINAL_EXEC] }
      },
      _count: { _all: true }
    }),
    getManagerFinanceOverview(prisma, session, { teamMode: true })
  ]);

  const aggBy = new Map(activeGroup.map((g) => [g.managerId, g]));
  const overdueBy = new Map(overdueGroup.map((g) => [g.managerId, g._count._all]));

  const perManager: LeaderManagerRow[] = managers.map((m) => {
    const agg = aggBy.get(m.id);
    return {
      managerId: m.id,
      name: m.name,
      email: m.email,
      activeOrders: agg?._count._all ?? 0,
      totalAmount: String(agg?._sum.totalAmount ?? '0'),
      paidAmount: String(agg?._sum.paidAmount ?? '0'),
      overdue: overdueBy.get(m.id) ?? 0
    };
  });

  let commissionTotal = 0;
  let hasCommission = false;
  for (const s of finance.sections) {
    if (s.commission) {
      hasCommission = true;
      commissionTotal += Number(s.commission.totalCommission);
    }
  }

  return {
    kpis: {
      managers: managers.length,
      activeOrders,
      debt: finance.summary.outstanding,
      commission: hasCommission ? commissionTotal.toFixed(2) : null
    },
    perManager
  };
}
