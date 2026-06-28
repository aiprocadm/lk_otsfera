import { requireSession } from '@/lib/auth/guard';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { sendMessage, listMessages } from '@/lib/services/chat/messages';
import { deriveSide } from '@/lib/services/chat/policy';

export async function POST(req: Request) {
  const off = notFoundIfDisabled('chat');
  if (off) return off;
  const sess = await requireSession();
  if (!sess.ok) return sess.response;
  const s = sess.value;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.orderId !== 'string' || typeof body.body !== 'string') {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  // External role forces its side; team passes side explicitly via body.side.
  const side = deriveSide(s) ?? body.side;
  if (side !== 'org' && side !== 'partner') {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const result = await sendMessage(prisma, s, {
    orderId: body.orderId,
    side,
    body: body.body,
    attachmentPath: typeof body.attachmentPath === 'string' ? body.attachmentPath : undefined,
  });

  if (!result.ok) {
    const status =
      result.error === 'forbidden' ? 403 :
      result.error === 'order_not_found' ? 404 :
      result.error === 'too_large' ? 413 :
      400;
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json({ ok: true, messageId: result.messageId }, { status: 201 });
}

export async function GET(req: Request) {
  const off = notFoundIfDisabled('chat');
  if (off) return off;
  const sess = await requireSession();
  if (!sess.ok) return sess.response;

  const url = new URL(req.url);
  const threadId = url.searchParams.get('threadId') ?? '';
  const after = url.searchParams.get('after') ?? undefined;

  const result = await listMessages(prisma, sess.value, {
    threadId,
    ...(after ? { after } : {}),
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error },
      { status: result.error === 'forbidden' ? 403 : 404 }
    );
  }

  return Response.json({ ok: true, rows: result.rows });
}
