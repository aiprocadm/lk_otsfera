import type { PrismaClient, Prisma, TrainingStatus } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder } from '@/lib/services/manager/orders';
import { recordAudit } from '@/lib/auth/audit';
import { recordPiiAccess } from '@/lib/pii/record';

export type OrderItemsError =
  | 'forbidden'
  | 'not_found'
  | 'direction_inactive'
  | 'duplicate_position'
  | 'student_mismatch'
  | 'validation';
type Result<T> = ({ ok: true } & T) | { ok: false; error: OrderItemsError };

const ITEM_INCLUDE = {
  student: { select: { id: true, name: true, email: true } },
  direction: { select: { id: true, name: true } },
  certificate: { select: { id: true, number: true, validUntil: true } },
} satisfies Prisma.OrderItemInclude;

export type OrderItemRow = Prisma.OrderItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

function canEditPositions(session: SessionPayload): boolean {
  return session.role === 'admin' || session.role === 'manager';
}

async function visibleOrder(prisma: PrismaClient, session: SessionPayload, orderId: string) {
  return getOrder(prisma, session, orderId);
}

export async function listOrderItems(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string }
): Promise<Result<{ items: OrderItemRow[] }>> {
  const order = await visibleOrder(prisma, session, args.orderId);
  if (!order) return { ok: false, error: 'forbidden' };
  const items = await prisma.orderItem.findMany({
    where: { orderId: args.orderId },
    include: ITEM_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });
  await recordPiiAccess(prisma, {
    session,
    context: 'order_items_list',
    subjectIds: items.map((i) => i.studentId),
  });
  return { ok: true, items };
}

export async function addOrderItem(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; studentId: string; directionId: string; note?: string }
): Promise<Result<{ item: { id: string } }>> {
  if (!canEditPositions(session)) return { ok: false, error: 'forbidden' };
  const order = await visibleOrder(prisma, session, args.orderId);
  if (!order) return { ok: false, error: 'forbidden' };

  const student = await prisma.student.findUnique({
    where: { id: args.studentId },
    select: { id: true, organizationId: true },
  });
  if (!student) return { ok: false, error: 'not_found' };
  if (student.organizationId !== order.organizationId)
    return { ok: false, error: 'student_mismatch' };

  const direction = await prisma.trainingDirection.findUnique({
    where: { id: args.directionId },
    select: { id: true, isActive: true },
  });
  if (!direction) return { ok: false, error: 'not_found' };
  if (!direction.isActive) return { ok: false, error: 'direction_inactive' };

  try {
    const item = await prisma.orderItem.create({
      data: {
        orderId: args.orderId,
        studentId: args.studentId,
        directionId: args.directionId,
        note: args.note?.trim() || null,
      },
      select: { id: true },
    });
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'order_item_added',
      entity: 'order_item',
      entityId: item.id,
      after: { orderId: args.orderId, studentId: args.studentId, directionId: args.directionId },
    });
    return { ok: true, item };
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002')
      return { ok: false, error: 'duplicate_position' };
    throw e;
  }
}

export async function updateItemStatus(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { itemId: string; trainingStatus: TrainingStatus }
): Promise<Result<{ item: { id: string } }>> {
  if (!canEditPositions(session)) return { ok: false, error: 'forbidden' };
  const existing = await prisma.orderItem.findUnique({
    where: { id: args.itemId },
    select: { id: true, orderId: true, trainingStatus: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };
  const order = await visibleOrder(prisma, session, existing.orderId);
  if (!order) return { ok: false, error: 'forbidden' };
  await prisma.orderItem.update({
    where: { id: args.itemId },
    data: { trainingStatus: args.trainingStatus },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_item_status_changed',
    entity: 'order_item',
    entityId: args.itemId,
    after: { from: existing.trainingStatus, to: args.trainingStatus },
  });
  return { ok: true, item: { id: args.itemId } };
}

export async function removeOrderItem(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { itemId: string }
): Promise<Result<{ removed: true }>> {
  if (!canEditPositions(session)) return { ok: false, error: 'forbidden' };
  const existing = await prisma.orderItem.findUnique({
    where: { id: args.itemId },
    select: { id: true, orderId: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };
  const order = await visibleOrder(prisma, session, existing.orderId);
  if (!order) return { ok: false, error: 'forbidden' };
  await prisma.orderItem.delete({ where: { id: args.itemId } });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_item_removed',
    entity: 'order_item',
    entityId: args.itemId,
  });
  return { ok: true, removed: true };
}
