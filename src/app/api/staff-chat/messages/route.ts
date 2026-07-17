import { requireSession, requireRole } from '@/lib/auth/guard';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { sendStaffMessage, listStaffMessages } from '@/lib/services/staffChat/messages';

export async function GET(req: Request) {
  const off = notFoundIfDisabled('staff_chat');
  if (off) return off;
  const sess = await requireSession();
  if (!sess.ok) return sess.response;
  const staff = requireRole(sess.value, ['admin', 'manager']);
  if (!staff.ok) return staff.response;

  const url = new URL(req.url);
  const conversationId = url.searchParams.get('conversationId');
  if (!conversationId) {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }
  const after = url.searchParams.get('after') ?? undefined;

  const result = await listStaffMessages(prisma, sess.value, {
    conversationId,
    ...(after ? { after } : {}),
  });

  if (!result.ok) {
    const status = result.error === 'forbidden' ? 403 : 404;
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json({ ok: true, rows: result.rows });
}

export async function POST(req: Request) {
  const off = notFoundIfDisabled('staff_chat');
  if (off) return off;
  const sess = await requireSession();
  if (!sess.ok) return sess.response;
  const staff = requireRole(sess.value, ['admin', 'manager']);
  if (!staff.ok) return staff.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.conversationId !== 'string' || typeof body.body !== 'string') {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const result = await sendStaffMessage(prisma, sess.value, {
    conversationId: body.conversationId,
    body: body.body,
    attachmentPath: typeof body.attachmentPath === 'string' ? body.attachmentPath : undefined,
    attachmentName: typeof body.attachmentName === 'string' ? body.attachmentName : undefined,
    attachmentMime: typeof body.attachmentMime === 'string' ? body.attachmentMime : undefined,
  });

  if (!result.ok) {
    const status =
      result.error === 'forbidden' ? 403 :
      result.error === 'conversation_not_found' ? 404 :
      result.error === 'too_large' ? 413 :
      400; // 'empty_body'
    return Response.json({ ok: false, error: result.error }, { status });
  }

  return Response.json({ ok: true, messageId: result.messageId }, { status: 201 });
}
