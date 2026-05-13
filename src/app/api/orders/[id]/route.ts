import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notifyStatusChanged, triggerNotificationEmail } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await prisma.organizationUser.findFirst({ where: { userId: s.sub, isActive: true } });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { status } = await req.json();
  const order = await prisma.order.update({ where: { id: params.id }, data: { status } });
  const organizationId = await getPrimaryOrganizationId(s);

  await notifyStatusChanged({
    userId: s.sub,
    organizationId,
    partnerId: s.partnerId,
    title: 'Смена статуса заказа',
    body: `Заказ ${order.title} переведен в статус ${status}`,
    meta: { orderId: order.id, status }
  });

  await triggerNotificationEmail({ userId: s.sub, title: 'Смена статуса заказа', body: `Заказ ${order.title}: ${status}`, type: 'status_changed' });

  return NextResponse.json(order);
}
