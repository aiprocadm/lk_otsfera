import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';
import { getStaffBadges } from '@/lib/services/intake/badges';

/**
 * GET /api/staff/badges — агрегирующий эндпоинт счётчиков меню сотрудника
 * (этап 7, ФТ-8.4): {intake, tasksOverdue}. Один запрос на поллинг 30 с
 * (образец /api/notifications/unread). Только staff — клиентским ролям 403.
 */
export async function GET() {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const session = sessionResult.value;

  const roleResult = requireRole(session, ['admin', 'manager', 'leader']);
  if (!roleResult.ok) return roleResult.response;

  const badges = await getStaffBadges(prisma, session);
  return Response.json(badges);
}
