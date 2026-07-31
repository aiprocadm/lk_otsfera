import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';
import { buildNotificationScopeWhere } from '@/lib/services/notifications/scope';

/**
 * GET /api/notifications/unread — счётчик непрочитанных уведомлений (Task C1,
 * parity). Гейты и scope те же, что у GET /api/notifications; поверх скоупа —
 * фильтр isRead:false. Запрос обслуживается индексом
 * Notification @@index([userId, isRead]) (F2 §16).
 */
export async function GET() {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const session = sessionResult.value;

  const roleResult = requireRole(session, ['admin', 'manager', 'partner', 'organization']);
  if (!roleResult.ok) return roleResult.response;

  const scope = await buildNotificationScopeWhere(prisma, session);

  const count = await prisma.notification.count({
    where: { AND: [scope, { isRead: false }] },
  });

  return Response.json({ count });
}
