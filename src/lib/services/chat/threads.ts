import type { PrismaClient, ThreadSide, OrderThread } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeThread } from './policy';

export type ChatError = 'forbidden' | 'order_not_found';

export type ThreadResult =
  | { ok: true; thread: OrderThread }
  | { ok: false; error: ChatError };

export async function findOrCreateThread(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; side: ThreadSide }
): Promise<ThreadResult> {
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: { id: true, organizationId: true, partnerId: true }
  });
  if (!order) return { ok: false, error: 'order_not_found' };
  if (!canSeeThread(session, args.side, order)) return { ok: false, error: 'forbidden' };

  const thread = await prisma.orderThread.upsert({
    where: { orderId_side: { orderId: args.orderId, side: args.side } },
    update: {},
    create: { orderId: args.orderId, side: args.side }
  });
  return { ok: true, thread };
}
