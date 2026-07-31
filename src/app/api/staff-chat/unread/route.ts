import { withAuth } from '@/lib/api/withAuth';
import { requireRole } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { staffUnreadCount } from '@/lib/services/staffChat/conversations';

const requireStaff = (session: Parameters<typeof requireRole>[0]) =>
  requireRole(session, ['admin', 'manager']);

export const GET = withAuth({ feature: 'staff_chat', guard: requireStaff }, async ({ session }) => {
  const result = await staffUnreadCount(prisma, session);
  return Response.json({ ok: true, count: result.count });
});
