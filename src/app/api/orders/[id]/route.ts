import { OrderStatus } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrderAccess, requireRole, requireSession } from '@/lib/auth/guard';
import { notifyStatusChanged, triggerNotificationEmail } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';

const patchOrderSchema = z.object({
  status: z.nativeEnum(OrderStatus)
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  const roleResult = requireRole(s, ['admin', 'manager', 'organization']);
  if (!roleResult.ok) return roleResult.response;

  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const orderAccess = await requireOrderAccess(s, order);
  if (!orderAccess.ok) return orderAccess.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 });
  }
  const parsedBody = patchOrderSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 });
  }

  const { status } = parsedBody.data;
  const updatedOrder = await prisma.order.update({ where: { id }, data: { status } });
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
