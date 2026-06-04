import type { PrismaClient, ThreadSide, OrderThread, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeThread } from './policy';
import { activeOrgIds } from '@/lib/auth/organizationPolicy';

export type ChatError = 'forbidden' | 'order_not_found';

export type ThreadResult =
  | { ok: true; thread: OrderThread }
  | { ok: false; error: ChatError };

export type ThreadRow = {
  id: string;
  orderId: string;
  side: ThreadSide;
  orderNumber: string | null;
  orderTitle: string;
  lastMessageAt: Date;
  unread: boolean;
};

export type ListThreadsResult = { ok: true; rows: ThreadRow[] };

export type MarkReadResult = { ok: true } | { ok: false; error: 'thread_not_found' | 'forbidden' };

export type UnreadCountResult = { ok: true; count: number };

/**
 * Private helper: builds the Prisma `where` clause scoped by the caller's role.
 * Used by both listThreads and unreadCount to avoid duplicating the role→where mapping.
 */
function scopeWhere(session: SessionPayload): Prisma.OrderThreadWhereInput | null {
  if (session.role === 'manager' || session.role === 'admin') {
    return {}; // team sees ALL threads
  }
  if (session.role === 'organization') {
    return { side: 'org', order: { organizationId: { in: activeOrgIds(session) } } };
  }
  if (session.role === 'partner') {
    return { side: 'partner', order: { partnerId: session.partnerId ?? '' } };
  }
  return null; // any other role: no threads
}

/**
 * Role-scoped inbox. Returns up to 50 most recent threads for the caller.
 * No cursor pagination in v1 — take 50 newest ordered by lastMessageAt desc.
 */
export async function listThreads(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<ListThreadsResult> {
  const where = scopeWhere(session);
  if (where === null) return { ok: true, rows: [] };

  const threads = await prisma.orderThread.findMany({
    where,
    take: 50,
    orderBy: { lastMessageAt: 'desc' },
    select: {
      id: true,
      orderId: true,
      side: true,
      lastMessageAt: true,
      order: { select: { orderNumber: true, title: true } },
      readStates: {
        where: { userId: session.sub },
        select: { lastReadAt: true },
        take: 1
      }
    }
  });

  const rows: ThreadRow[] = threads.map((t) => ({
    id: t.id,
    orderId: t.orderId,
    side: t.side,
    orderNumber: t.order.orderNumber,
    orderTitle: t.order.title,
    lastMessageAt: t.lastMessageAt,
    unread: t.lastMessageAt > (t.readStates[0]?.lastReadAt ?? new Date(0))
  }));

  return { ok: true, rows };
}

/**
 * Marks the caller as having read the given thread up to now.
 * Guards access via canSeeThread before upserting the read state.
 */
export async function markRead(
  prisma: PrismaClient,
  session: SessionPayload,
  threadId: string
): Promise<MarkReadResult> {
  const thread = await prisma.orderThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      side: true,
      order: { select: { id: true, organizationId: true, partnerId: true } }
    }
  });
  if (!thread) return { ok: false, error: 'thread_not_found' };
  if (!canSeeThread(session, thread.side, thread.order)) return { ok: false, error: 'forbidden' };

  await prisma.threadReadState.upsert({
    where: { threadId_userId: { threadId, userId: session.sub } },
    update: { lastReadAt: new Date() },
    create: { threadId, userId: session.sub }
  });

  return { ok: true };
}

/**
 * Returns the count of threads the caller has not yet read (unread threads).
 * Reuses scopeWhere to stay consistent with listThreads scoping.
 */
export async function unreadCount(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<UnreadCountResult> {
  const where = scopeWhere(session);
  if (where === null) return { ok: true, count: 0 };

  const threads = await prisma.orderThread.findMany({
    where,
    select: {
      lastMessageAt: true,
      readStates: {
        where: { userId: session.sub },
        select: { lastReadAt: true },
        take: 1
      }
    }
  });

  const count = threads.filter(
    (t) => t.lastMessageAt > (t.readStates[0]?.lastReadAt ?? new Date(0))
  ).length;

  return { ok: true, count };
}

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
