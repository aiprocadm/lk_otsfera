/**
 * Скоуп видимости уведомлений по роли сессии (Task C1, parity) — вынесен
 * из src/app/api/notifications/route.ts без изменения поведения. Общая
 * реализация для GET/PATCH /api/notifications и GET /api/notifications/unread.
 *
 * Для unread-count meta-ветка менеджера унаследованно ограничена LIMIT 50
 * кандидатами — счётчик может недосчитывать старые order-bound уведомления
 * (известное ограничение, R1.2).
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { managedOrgIds, managerOrderScopeFilter } from '@/lib/auth/managerPolicy';

import type { SessionPayload } from '@/lib/auth/jwt';

export type NotificationScopeOptions = { candidateIds?: string[] };

export async function buildNotificationScopeWhere(
  prisma: PrismaClient,
  session: SessionPayload,
  opts: NotificationScopeOptions = {}
) {
  if (session.role === 'admin') return {};

  if (session.role === 'manager') {
    // Manager visibility follows managerOrderScopeFilter (per-order ownership +
    // per-org scope from session.managedOrgIds + historical commenter access).
    // Notification has no direct Order FK, so we hydrate the in-scope order IDs
    // and match them via meta.orderId for order-bound fan-outs that did not
    // also stamp organizationId (e.g. per-order ownership in a foreign org).
    //
    // R1.2: раньше на КАЖДЫЙ видимый заказ строилась отдельная OR-ветка с
    // JSONB-путём — при тысячах заказов SQL-план взрывался. Теперь кандидаты
    // собираются ОДНИМ raw-запросом `meta->>'orderId' IN (…)` и входят в scope
    // веткой `id IN (…)`. Контракт сохранён: GET отдаёт top-50 по createdAt —
    // top-50 кандидатов по createdAt покрывают любой возможный вклад meta-ветки
    // в этот срез; PATCH ограничен своими candidateIds (≤100 по схеме), поэтому
    // кандидаты фильтруются ими и остаются bounded.
    const orgIds = managedOrgIds(session);
    const visibleOrders = await prisma.order.findMany({
      where: managerOrderScopeFilter(session),
      select: { id: true }
    });
    const orderIds = visibleOrders.map((order) => order.id);

    const branches: Array<Record<string, unknown>> = [{ userId: session.sub }];
    if (orgIds.length > 0) branches.push({ organizationId: { in: orgIds } });

    if (orderIds.length > 0) {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>(
        opts.candidateIds
          ? Prisma.sql`SELECT id FROM "Notification"
              WHERE id IN (${Prisma.join(opts.candidateIds)})
                AND (meta->>'orderId') IN (${Prisma.join(orderIds)})`
          : Prisma.sql`SELECT id FROM "Notification"
              WHERE (meta->>'orderId') IN (${Prisma.join(orderIds)})
              ORDER BY "createdAt" DESC
              LIMIT 50`
      );
      if (rows.length > 0) branches.push({ id: { in: rows.map((r) => r.id) } });
    }

    return { OR: branches };
  }

  const scope: Array<Record<string, unknown>> = [{ userId: session.sub }];

  if (session.role === 'partner' && session.partnerId) scope.push({ partnerId: session.partnerId });
  if (session.role === 'organization' && session.organizationId) {
    scope.push({ organizationId: session.organizationId });
  }

  return { OR: scope };
}

export type NotificationScopeWhere = Awaited<ReturnType<typeof buildNotificationScopeWhere>>;
