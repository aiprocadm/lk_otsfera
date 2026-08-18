import { withAuth } from '@/lib/api/withAuth';
import { requireRole } from '@/lib/auth/guard';
import { prisma } from '@/lib/db/prisma';
import { listColleagues } from '@/lib/services/staffChat/mentions';

const requireStaff = (session: Parameters<typeof requireRole>[0]) =>
  requireRole(session, ['admin', 'manager', 'leader']);

export const GET = withAuth({ feature: 'staff_chat', guard: requireStaff }, async ({ session }) => {
  const result = await listColleagues(prisma, session);
  return Response.json({ ok: true, rows: result.rows });
});
