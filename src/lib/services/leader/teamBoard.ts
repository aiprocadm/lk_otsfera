import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listCompanyManagers } from '@/lib/services/manager/team';

/**
 * «Команда» руководителя по макету 2 (`У-346`, ТЗ 28.10.2026, `В-ТР-5`): у
 * каждого менеджера — его организации со статистикой, и отдельно организации
 * компании без ответственного. Граница — компания руководителя (C8): чужие
 * организации и заказы сюда не попадают ни при каком переключателе видимости.
 *
 * Read-агрегатор (как `leaderDashboard`): простая форма, суммы строками (§3).
 */

const ACTIVE_EXEC = ['pending', 'in_progress'] as const;
const TERMINAL_EXEC = ['completed', 'cancelled'] as const;
/** Сколько организаций без менеджера показать списком; остальное — числом. */
export const UNASSIGNED_LIMIT = 50;

export type TeamBoardOrg = {
  assignmentId: string;
  organizationId: string;
  name: string;
  /** Заказы в работе (pending | in_progress). */
  activeOrders: number;
  /** Сумма заказов в работе. */
  inWork: string;
  /** Оплачено по заказам в работе. */
  paid: string;
  /** Просрочены: срок прошёл, заказ не закрыт. */
  overdue: number;
};

export type TeamBoardManager = {
  id: string;
  name: string;
  email: string;
  isLeader: boolean;
  isActive: boolean;
  lastLoginAt: Date | null;
  orgs: TeamBoardOrg[];
};

export type TeamBoard = {
  managers: TeamBoardManager[];
  unassigned: { rows: Array<{ id: string; name: string; inn: string | null }>; total: number };
};

const EMPTY: TeamBoard = { managers: [], unassigned: { rows: [], total: 0 } };

export async function getLeaderTeamBoard(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<TeamBoard> {
  const companyId = session.companyId;
  if (!companyId) return EMPTY;

  const unassignedWhere: Prisma.OrganizationWhereInput = {
    companyId,
    managers: { none: { isActive: true } },
  };
  const [roster, activeByOrg, overdueByOrg, unassignedRows, unassignedTotal] = await Promise.all([
    listCompanyManagers(prisma, companyId),
    prisma.order.groupBy({
      by: ['organizationId'],
      where: { companyId, executionStatus: { in: [...ACTIVE_EXEC] } },
      _count: { _all: true },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    prisma.order.groupBy({
      by: ['organizationId'],
      where: {
        companyId,
        deadline: { lt: new Date() },
        executionStatus: { notIn: [...TERMINAL_EXEC] },
      },
      _count: { _all: true },
    }),
    prisma.organization.findMany({
      where: unassignedWhere,
      select: { id: true, name: true, inn: true },
      orderBy: { name: 'asc' },
      take: UNASSIGNED_LIMIT,
    }),
    prisma.organization.count({ where: unassignedWhere }),
  ]);

  const active = new Map(activeByOrg.map((g) => [g.organizationId, g]));
  const overdue = new Map(overdueByOrg.map((g) => [g.organizationId, g._count._all]));

  const managers: TeamBoardManager[] = roster.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    isLeader: m.isLeader,
    isActive: m.isActive,
    lastLoginAt: m.lastLoginAt,
    orgs: m.assignments
      .filter((a) => a.isActive)
      .map((a) => {
        const g = active.get(a.organizationId);
        return {
          assignmentId: a.id,
          organizationId: a.organizationId,
          name: a.organizationName,
          activeOrders: g?._count._all ?? 0,
          inWork: new Prisma.Decimal(g?._sum.totalAmount ?? 0).toFixed(2),
          paid: new Prisma.Decimal(g?._sum.paidAmount ?? 0).toFixed(2),
          overdue: overdue.get(a.organizationId) ?? 0,
        };
      })
      .sort((x, y) => y.activeOrders - x.activeOrders || x.name.localeCompare(y.name, 'ru')),
  }));

  return { managers, unassigned: { rows: unassignedRows, total: unassignedTotal } };
}
