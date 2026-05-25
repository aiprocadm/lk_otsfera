import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrderAccess, requireSession, forbiddenResponse } from '@/lib/auth/guard';
import { canSeeOrder } from '@/lib/auth/organizationPolicy';
import { notifyMessageCreated, triggerNotificationEmail } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';
import { recordAudit } from '@/lib/auth/audit';

const commentSchema = z.object({
  orderId: z.string().min(1).max(64),
  body: z.string().trim().min(1).max(5000)
});

export async function POST(req: Request) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const parsed = commentSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { orderId, body } = parsed.data;

  // Organization-cabinet users: scope check via organizationMemberships array.
  // Legacy canReadOrder still relies on session.organizationId (singular) and
  // does not understand multi-org Phase 7 sessions, so handle this role here.
  if (s.role === 'organization') {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, organizationId: true }
    });
    if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canSeeOrder(s, order)) return forbiddenResponse('Access denied');

    const comment = await prisma.comment.create({
      data: { orderId, body, authorId: s.sub }
    });

    await recordAudit(prisma, {
      action: 'comment_posted',
      entity: 'order',
      entityId: orderId,
      userId: s.sub,
      after: { commentId: comment.id, viewer: 'organization' }
    });

    return NextResponse.json(comment, { status: 201 });
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const orderAccess = await requireOrderAccess(s, order);
  if (!orderAccess.ok) return orderAccess.response;

  const comment = await prisma.comment.create({ data: { orderId, body, authorId: s.sub } });
  const organizationId = await getPrimaryOrganizationId(s);

  await notifyMessageCreated({
    userId: s.sub,
    organizationId,
    partnerId: s.partnerId,
    title: 'Новое сообщение',
    body,
    meta: { orderId, commentId: comment.id }
  });

  await triggerNotificationEmail({ userId: s.sub, title: 'Новое сообщение', body, type: 'message_created' });

  return NextResponse.json(comment);
}
