import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrderScope, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { THIRTY_DAYS_MS, THREE_DAYS_MS, ACTIVE_EXEC, TERMINAL_EXEC } from './constants';

export type KpiData = {
  activeOrders: number;
  activeOrdersDelta: number;
  attentionCount: number;
  unreadComments: number;
  urgentDeadlines: number;
};

/**
 * KPI counts for the manager dashboard, scoped to orders the manager can see
 * via the three-way scope filter (per-order, per-org, comments-history).
 */
export async function kpis(
  prisma: PrismaClient,
  session: SessionPayload,
  teamModeOverride?: boolean
): Promise<KpiData> {
  const teamMode = teamModeOverride ?? (await getCompanyTeamVisibility(prisma, session.companyId));
  const scope = managerOrderScope(session, teamMode);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS);
  const threeDaysAhead = new Date(now.getTime() + THREE_DAYS_MS);

  const [activeOrders, activeOrders30dAgo, attentionCount, unreadComments, urgentDeadlines] =
    await Promise.all([
      prisma.order.count({
        where: { AND: [scope, { executionStatus: { in: [...ACTIVE_EXEC] } }] },
      }),
      prisma.order.count({
        where: {
          AND: [
            scope,
            { executionStatus: { in: [...ACTIVE_EXEC] } },
            { createdAt: { lte: thirtyDaysAgo } },
          ],
        },
      }),
      prisma.order.count({
        where: {
          AND: [
            scope,
            { deadline: { lt: now } },
            { executionStatus: { notIn: [...TERMINAL_EXEC] } },
          ],
        },
      }),
      prisma.notification.count({
        where: {
          userId: session.sub,
          isRead: false,
          type: 'comment_from_org',
        },
      }),
      prisma.order.count({
        where: {
          AND: [
            scope,
            { deadline: { gte: now, lt: threeDaysAhead } },
            { executionStatus: { notIn: [...TERMINAL_EXEC] } },
          ],
        },
      }),
    ]);

  return {
    activeOrders,
    activeOrdersDelta: activeOrders - activeOrders30dAgo,
    attentionCount,
    unreadComments,
    urgentDeadlines,
  };
}
