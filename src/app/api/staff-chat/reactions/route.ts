import { requireSession, requireRole } from '@/lib/auth/guard';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { toggleReaction } from '@/lib/services/staffChat/messages';

export async function POST(req: Request) {
  const off = notFoundIfDisabled('staff_chat');
  if (off) return off;
  const sess = await requireSession();
  if (!sess.ok) return sess.response;
  const staff = requireRole(sess.value, ['admin', 'manager']);
  if (!staff.ok) return staff.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.messageId !== 'string' || typeof body.emoji !== 'string') {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const result = await toggleReaction(prisma, sess.value, {
    messageId: body.messageId,
    emoji: body.emoji,
  });

  if (!result.ok) {
    const status =
      result.error === 'forbidden' ? 403 :
      result.error === 'message_not_found' ? 404 :
      400; // 'invalid'
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json({ ok: true, reacted: result.reacted });
}
