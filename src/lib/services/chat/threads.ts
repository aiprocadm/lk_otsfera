import { Prisma } from '@prisma/client';
import type { PrismaClient, ThreadSide, OrderThread } from '@prisma/client';
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
  if (session.role === 'admin') {
    return {}; // admin sees ALL threads (Model A)
  }
  if (session.role === 'manager') {
    // Both sides, but only within the manager's company — cross-company
    // isolation (C8 invariant) holds regardless of managerTeamVisibility.
    // The sentinel keeps companyId=null sessions at zero threads, not all.
    return { order: { companyId: session.companyId ?? '__no_company__' } };
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
 * SQL-зеркало scopeWhere для unreadCount (R1.2) — единственное место с raw SQL
 * в домене chat: условие «lastMessageAt > lastReadAt» — column-to-column
 * сравнение, которое Prisma-фильтром не выражается. Роль-ветки дублируют
 * scopeWhere НАМЕРЕННО и построчно (t = OrderThread, o = Order); при правке
 * одной функции правь вторую. Эквивалентность закреплена интеграционным
 * тестом (unread в listThreads ↔ unreadCount, services.chat.inbox.integration).
 */
function scopeSql(session: SessionPayload): Prisma.Sql | null {
  if (session.role === 'admin') {
    return Prisma.sql`TRUE`;
  }
  if (session.role === 'manager') {
    return Prisma.sql`o."companyId" = ${session.companyId ?? '__no_company__'}`;
  }
  if (session.role === 'organization') {
    const orgIds = activeOrgIds(session);
    // Пустой membership = ноль тредов (зеркало `in: []`); IN () невалиден в SQL.
    if (orgIds.length === 0) return Prisma.sql`FALSE`;
    return Prisma.sql`t."side" = 'org'::"ThreadSide" AND o."organizationId" IN (${Prisma.join(orgIds)})`;
  }
  if (session.role === 'partner') {
    return Prisma.sql`t."side" = 'partner'::"ThreadSide" AND o."partnerId" = ${session.partnerId ?? ''}`;
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
      order: { select: { id: true, organizationId: true, partnerId: true, companyId: true } }
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
 * Scoping mirrors listThreads via scopeSql (см. комментарий у scopeSql).
 *
 * R1.2: раньше — findMany ВСЕХ тредов scope с подзапросом readStates и счётом
 * в JS, на каждый 15-секундный поллинг UnreadBadge (admin — все треды системы).
 * Теперь один SQL-count: LEFT JOIN по unique (threadId, userId) строки не
 * размножает, COALESCE(to_timestamp(0)) повторяет JS-семантику «нет readState —
 * тред непрочитан».
 */
export async function unreadCount(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<UnreadCountResult> {
  const scope = scopeSql(session);
  if (scope === null) return { ok: true, count: 0 };

  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM "OrderThread" t
    JOIN "Order" o ON o."id" = t."orderId"
    LEFT JOIN "ThreadReadState" rs
      ON rs."threadId" = t."id" AND rs."userId" = ${session.sub}
    WHERE ${scope}
      AND t."lastMessageAt" > COALESCE(rs."lastReadAt", to_timestamp(0))
  `);

  return { ok: true, count: rows[0].count };
}

export async function findOrCreateThread(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; side: ThreadSide }
): Promise<ThreadResult> {
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: { id: true, organizationId: true, partnerId: true, companyId: true }
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
