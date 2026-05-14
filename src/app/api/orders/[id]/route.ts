import { OrderStatus } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrderAccess, requireSession } from '@/lib/auth/guard';
import { notifyStatusChanged, triggerNotificationEmail } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';

const patchOrderSchema = z.object({
  status: z.nativeEnum(OrderStatus)
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  const order = await prisma.order.findUnique({ where: { id: params.id } });
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const orderAccess = await requireOrderAccess(s, order);
  if (!orderAccess.ok) return orderAccess.response;

  const body = await req.json();
  const parsedBody = patchOrderSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 });
  }

  const { status } = parsedBody.data;
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
