import { requireSession, requireRole } from '@/lib/auth/guard';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { openDm } from '@/lib/services/staffChat/conversations';

export async function POST(req: Request) {
  const off = notFoundIfDisabled('staff_chat');
  if (off) return off;
  const sess = await requireSession();
  if (!sess.ok) return sess.response;
  const staff = requireRole(sess.value, ['admin', 'manager']);
  if (!staff.ok) return staff.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.targetUserId !== 'string') {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const result = await openDm(prisma, sess.value, { targetUserId: body.targetUserId });

  if (!result.ok) {
    const status = result.error === 'forbidden' ? 403 : 404; // 'target_not_found'
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json({ ok: true, conversationId: result.conversationId }, { status: 201 });
}
