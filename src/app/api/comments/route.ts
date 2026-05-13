import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notifyMessageCreated, triggerNotificationEmail } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await prisma.organizationUser.findFirst({ where: { userId: s.sub, isActive: true } });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { orderId, body } = await req.json();
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
