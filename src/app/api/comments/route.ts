import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notifyMessageCreated, triggerNotificationEmail } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';
import { canReadOrder, forbiddenResponse } from '@/lib/auth/policy';

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { orderId, body } = await req.json();
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await canReadOrder(s, order))) return forbiddenResponse('You do not have access to comment this order');

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
