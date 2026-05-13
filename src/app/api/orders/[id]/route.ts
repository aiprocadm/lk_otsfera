import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notifyStatusChanged, triggerNotificationEmail } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';
import { canReadOrder, forbiddenResponse } from '@/lib/auth/policy';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const order = await prisma.order.findUnique({ where: { id: params.id } });
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await canReadOrder(s, order))) return forbiddenResponse('You do not have access to this order');

  const { status } = await req.json();
  const updatedOrder = await prisma.order.update({ where: { id: params.id }, data: { status } });
  const organizationId = await getPrimaryOrganizationId(s);

  await notifyStatusChanged({
    userId: s.sub,
    organizationId,
    partnerId: s.partnerId,
    title: 'Смена статуса заказа',
    body: `Заказ ${updatedOrder.title} переведен в статус ${status}`,
    meta: { orderId: updatedOrder.id, status }
  });

  await triggerNotificationEmail({ userId: s.sub, title: 'Смена статуса заказа', body: `Заказ ${updatedOrder.title}: ${status}`, type: 'status_changed' });

  return NextResponse.json(updatedOrder);
}
