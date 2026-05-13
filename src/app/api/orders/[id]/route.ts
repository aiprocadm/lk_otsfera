import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notifyStatusChanged, triggerNotificationEmail } from '@/lib/notifications';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { status } = await req.json();
  const order = await prisma.order.update({ where: { id: params.id }, data: { status } });

  await notifyStatusChanged({
    userId: s.sub,
    organizationId: s.organizationId,
    partnerId: s.partnerId,
    title: 'Смена статуса заказа',
    body: `Заказ ${order.title} переведен в статус ${status}`,
    meta: { orderId: order.id, status }
  });

  await triggerNotificationEmail({ userId: s.sub, title: 'Смена статуса заказа', body: `Заказ ${order.title}: ${status}`, type: 'status_changed' });

  return NextResponse.json(order);
}
