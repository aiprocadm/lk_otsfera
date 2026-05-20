import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrderAccess, requireSession } from '@/lib/auth/guard';
import { notifyMessageCreated, triggerNotificationEmail } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';

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
