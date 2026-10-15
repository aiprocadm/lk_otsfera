import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrderScope, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { orderFocusWhere } from '@/lib/services/manager/orderFocus';

export type KpiData = {
  activeOrders: number;
  attentionCount: number;
  unreadComments: number;
  urgentDeadlines: number;
};

/**
 * KPI counts for the manager dashboard, scoped to orders the manager can see
 * via the three-way scope filter (per-order, per-org, comments-history).
 *
 * Этап 4 ТЗ 13.10.2026 (`У-297`, `Р-4-3`): три заказных плитки считаются
 * условиями «фокуса» списка заказов (`orderFocusWhere`) — тем же, что фильтрует
 * список после перехода, поэтому число на плитке равно числу строк. Разница
 * «±N за 30 дней» убрана вместе с её запросом: подпись «/ 30д» была непонятна
 * (`Р-4-5`).
 */
export async function kpis(
  prisma: PrismaClient,
  session: SessionPayload,
  teamModeOverride?: boolean
): Promise<KpiData> {
  const teamMode = teamModeOverride ?? (await getCompanyTeamVisibility(prisma, session.companyId));
  const scope = managerOrderScope(session, teamMode);
  const now = new Date();

  const [activeOrders, attentionCount, unreadComments, urgentDeadlines] = await Promise.all([
    prisma.order.count({ where: { AND: [scope, orderFocusWhere('active', now)] } }),
    prisma.order.count({ where: { AND: [scope, orderFocusWhere('overdue', now)] } }),
    prisma.notification.count({
      where: {
        userId: session.sub,
        isRead: false,
        type: 'comment_from_org',
      },
    }),
    prisma.order.count({ where: { AND: [scope, orderFocusWhere('due_soon', now)] } }),
  ]);

  return { activeOrders, attentionCount, unreadComments, urgentDeadlines };
}
