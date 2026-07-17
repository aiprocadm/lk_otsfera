import { requireSession, requireRole } from '@/lib/auth/guard';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { staffUnreadCount } from '@/lib/services/staffChat/conversations';

export async function GET() {
  const off = notFoundIfDisabled('staff_chat');
  if (off) return off;
  const sess = await requireSession();
  if (!sess.ok) return sess.response;
  const staff = requireRole(sess.value, ['admin', 'manager']);
  if (!staff.ok) return staff.response;

  const result = await staffUnreadCount(prisma, sess.value);
  return Response.json({ ok: true, count: result.count });
}
