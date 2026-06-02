import { requireSession } from '@/lib/auth/guard';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { markRead } from '@/lib/services/chat/threads';

export async function POST(req: Request) {
  const off = notFoundIfDisabled('chat');
  if (off) return off;
  const sess = await requireSession();
  if (!sess.ok) return sess.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.threadId !== 'string') {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const result = await markRead(prisma, sess.value, body.threadId);
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error },
      { status: result.error === 'forbidden' ? 403 : 404 }
    );
  }

  return Response.json({ ok: true });
}
