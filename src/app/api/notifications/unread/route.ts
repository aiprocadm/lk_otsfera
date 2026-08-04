import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';
import { countUnreadNotifications } from '@/lib/services/notifications/inbox';

/**
 * GET /api/notifications/unread — счётчик непрочитанных уведомлений (Task C1,
 * parity). Гейты и scope те же, что у GET /api/notifications (общий
 * `buildNotificationScopeWhere` внутри сервиса); поверх скоупа — фильтр
 * isRead:false.
 */
export async function GET() {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const session = sessionResult.value;

  const roleResult = requireRole(session, ['admin', 'manager', 'partner', 'organization']);
  if (!roleResult.ok) return roleResult.response;

  const result = await countUnreadNotifications(prisma, session);

  return Response.json({ count: result.count });
}
