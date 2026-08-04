import type { Notification, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { buildNotificationScopeWhere } from '@/lib/services/notifications/scope';

/**
 * Чтение и отметка прочтения уведомлений (роуты `/api/notifications` и
 * `/api/notifications/unread`).
 *
 * Скоуп по роли — единый `buildNotificationScopeWhere`; он же ограничивает
 * PATCH: id из тела запроса добавляется к скоупу через `AND`, поэтому пометить
 * чужое уведомление нельзя, даже зная его id (проверка не «найти и сравнить»,
 * а фильтр в самом `updateMany` — гонок нет).
 *
 * Для PATCH скоуп строится с `candidateIds`: тяжёлая meta-ветка менеджера
 * ограничивается ровно теми id, которые пришли в запросе.
 */

export type MarkNotificationsReadArgs =
  { id: string; isRead: boolean } | { ids: string[]; isRead: boolean };

export async function listNotifications(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; notifications: Notification[] }> {
  const where = await buildNotificationScopeWhere(prisma, session);

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return { ok: true, notifications };
}

/**
 * Счётчик непрочитанных. Запрос обслуживается индексом
 * Notification @@index([userId, isRead]) (F2 §16).
 */
export async function countUnreadNotifications(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; count: number }> {
  const scope = await buildNotificationScopeWhere(prisma, session);

  const count = await prisma.notification.count({
    where: { AND: [scope, { isRead: false }] },
  });

  return { ok: true, count };
}

export async function markNotificationsRead(
  prisma: PrismaClient,
  session: SessionPayload,
  args: MarkNotificationsReadArgs
): Promise<{ ok: true; updated: { count: number } }> {
  const idFilter = 'id' in args ? { id: args.id } : { id: { in: args.ids } };
  const where = await buildNotificationScopeWhere(prisma, session, {
    candidateIds: 'id' in args ? [args.id] : args.ids,
  });

  const updated = await prisma.notification.updateMany({
    where: { AND: [idFilter, where] },
    data: { isRead: args.isRead },
  });

  return { ok: true, updated };
}
