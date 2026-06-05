import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrderScopeFilter } from '@/lib/auth/managerPolicy';

export type KpiData = {
  activeOrders: number;
  activeOrdersDelta: number;
  attentionCount: number;
  unreadComments: number;
  urgentDeadlines: number;
};

export type AttentionItem = {
  id: string;
  kind: string;
  severity: 'warn' | 'urgent';
  message: string;
  href: string;
};

export type EventItem = {
  id: string;
  kind: string;
  when: Date;
  text: string;
  href?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;
const FOURTEEN_DAYS_MS = 14 * DAY_MS;
const THREE_DAYS_MS = 3 * DAY_MS;
const ONE_DAY_MS = 1 * DAY_MS;
const ATTENTION_CAP_PER_SOURCE = 10;
const DEFAULT_EVENTS = 15;

// ExecutionStatus enum: pending | in_progress | completed | cancelled | on_hold
const ACTIVE_EXEC = ['pending', 'in_progress'] as const;
const TERMINAL_EXEC = ['completed', 'cancelled'] as const;

/**
 * KPI counts for the manager dashboard, scoped to orders the manager can see
 * via the three-way scope filter (per-order, per-org, comments-history).
 */
export async function kpis(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<KpiData> {
  const scope = managerOrderScopeFilter(session);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS);
  const threeDaysAhead = new Date(now.getTime() + THREE_DAYS_MS);

  const [
    activeOrders,
    activeOrders30dAgo,
    attentionCount,
    unreadComments,
    urgentDeadlines
  ] = await Promise.all([
    prisma.order.count({
      where: { AND: [scope, { executionStatus: { in: [...ACTIVE_EXEC] } }] }
    }),
    prisma.order.count({
      where: {
        AND: [
          scope,
          { executionStatus: { in: [...ACTIVE_EXEC] } },
          { createdAt: { lte: thirtyDaysAgo } }
        ]
      }
    }),
    prisma.order.count({
      where: {
        AND: [
          scope,
          { deadline: { lt: now } },
          { executionStatus: { notIn: [...TERMINAL_EXEC] } }
        ]
      }
    }),
    prisma.notification.count({
      where: {
        userId: session.sub,
        isRead: false,
        type: 'comment_from_org'
      }
    }),
    prisma.order.count({
      where: {
        AND: [
          scope,
          { deadline: { gte: now, lt: threeDaysAhead } },
          { executionStatus: { notIn: [...TERMINAL_EXEC] } }
        ]
      }
    })
  ]);

  return {
    activeOrders,
    activeOrdersDelta: activeOrders - activeOrders30dAgo,
    attentionCount,
    unreadComments,
    urgentDeadlines
  };
}

/**
 * Items that should appear in the «Требует внимания» list. Sources:
 *   - urgent: orders past deadline (not completed/cancelled)
 *   - urgent: comments from organization users older than 24h with no later
 *             reply from this manager on the same order
 *   - warn:   `act` documents unsigned for more than 3 days
 *   - warn:   in-progress orders without movement (updatedAt) for >14 days
 * Sorted urgent-before-warn; each source capped per-source.
 */
export async function attention(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<AttentionItem[]> {
  const scope = managerOrderScopeFilter(session);
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - ONE_DAY_MS);
  const threeDaysAgo = new Date(now.getTime() - THREE_DAYS_MS);
  const fourteenDaysAgo = new Date(now.getTime() - FOURTEEN_DAYS_MS);

  const [overdueOrders, recentOrgComments, unsignedActs, stalledOrders] =
    await Promise.all([
      prisma.order.findMany({
        where: {
          AND: [
            scope,
            { deadline: { lt: now } },
            { executionStatus: { notIn: [...TERMINAL_EXEC] } }
          ]
        },
        orderBy: { deadline: 'asc' },
        take: ATTENTION_CAP_PER_SOURCE,
        select: { id: true, orderNumber: true, title: true }
      }),
      prisma.comment.findMany({
        where: {
          createdAt: { lt: twentyFourHoursAgo },
          author: { role: 'organization' },
          order: scope
        },
        orderBy: { createdAt: 'desc' },
        take: ATTENTION_CAP_PER_SOURCE * 3,
        select: {
          id: true,
          createdAt: true,
          orderId: true,
          order: { select: { orderNumber: true, title: true } }
        }
      }),
      prisma.document.findMany({
        where: {
          type: 'act',
          signedAt: null,
          createdAt: { lt: threeDaysAgo },
          scanStatus: { not: 'infected' },
          order: scope
        },
        orderBy: { createdAt: 'asc' },
        take: ATTENTION_CAP_PER_SOURCE,
        select: {
          id: true,
          name: true,
          orderId: true,
          order: { select: { orderNumber: true } }
        }
      }),
      prisma.order.findMany({
        where: {
          AND: [
            scope,
            { executionStatus: 'in_progress' },
            { updatedAt: { lt: fourteenDaysAgo } }
          ]
        },
        orderBy: { updatedAt: 'asc' },
        take: ATTENTION_CAP_PER_SOURCE,
        select: {
          id: true,
          orderNumber: true,
          title: true,
          updatedAt: true
        }
      })
    ]);

  // For "no-reply > 24h" we need to filter recent org comments: keep one entry
  // per order where the latest comment from an organization user has no later
  // reply from THIS manager. To stay efficient we ask Prisma for the most-recent
  // comment by this manager per order in a single query.
  const candidateOrderIds = Array.from(
    new Set(recentOrgComments.map((c) => c.orderId))
  );
  let myLatestByOrder = new Map<string, Date>();
  if (candidateOrderIds.length > 0) {
    const myReplies = await prisma.comment.findMany({
      where: {
        orderId: { in: candidateOrderIds },
        authorId: session.sub
      },
      orderBy: { createdAt: 'desc' },
      select: { orderId: true, createdAt: true }
    });
    myLatestByOrder = myReplies.reduce((acc, r) => {
      const prev = acc.get(r.orderId);
      if (!prev || prev < r.createdAt) acc.set(r.orderId, r.createdAt);
      return acc;
    }, new Map<string, Date>());
  }
  const seenOrderIds = new Set<string>();
  const noReplyComments: typeof recentOrgComments = [];
  for (const c of recentOrgComments) {
    if (seenOrderIds.has(c.orderId)) continue;
    const myLatest = myLatestByOrder.get(c.orderId);
    if (myLatest && myLatest >= c.createdAt) continue;
    seenOrderIds.add(c.orderId);
    noReplyComments.push(c);
    if (noReplyComments.length >= ATTENTION_CAP_PER_SOURCE) break;
  }

  const items: AttentionItem[] = [
    ...overdueOrders.map((o): AttentionItem => ({
      id: `overdue-${o.id}`,
      kind: 'order_overdue',
      severity: 'urgent',
      message: `Просрочен дедлайн по заказу ${o.orderNumber ?? o.title}`,
      href: `/manager/orders/${o.id}`
    })),
    ...noReplyComments.map((c): AttentionItem => ({
      id: `noreply-${c.id}`,
      kind: 'org_comment_unreplied',
      severity: 'urgent',
      message: `Нет ответа клиенту >24ч по заказу ${c.order.orderNumber ?? c.order.title}`,
      href: `/manager/orders/${c.orderId}`
    })),
    ...unsignedActs.map((d): AttentionItem => ({
      id: `act-${d.id}`,
      kind: 'act_unsigned',
      severity: 'warn',
      message: `Акт «${d.name}» >3 дней без подписи (заказ ${d.order.orderNumber ?? ''})`.trim(),
      href: `/manager/orders/${d.orderId}`
    })),
    ...stalledOrders.map((o): AttentionItem => ({
      id: `stalled-${o.id}`,
      kind: 'order_stalled',
      severity: 'warn',
      message: `Заказ ${o.orderNumber ?? o.title} без движения >14 дней`,
      href: `/manager/orders/${o.id}`
    }))
  ];

  // Urgent before warn (stable within each group)
  items.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === 'urgent' ? -1 : 1;
  });

  return items;
}

/**
 * Recent events merged from documents, payments, status-change audit log
 * entries, and comments. All scoped via `managerOrderScopeFilter` so that
 * an event for an out-of-scope order is never emitted. Sorted by timestamp
 * desc and sliced to `take`.
 */
export async function recentEvents(
  prisma: PrismaClient,
  session: SessionPayload,
  take = DEFAULT_EVENTS
): Promise<EventItem[]> {
  const scope = managerOrderScopeFilter(session);
  const fetchLimit = Math.max(20, take);

  const [documents, payments, statusAudits, comments] = await Promise.all([
    prisma.document.findMany({
      where: { order: scope, scanStatus: { not: 'infected' } },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
      select: {
        id: true,
        name: true,
        createdAt: true,
        orderId: true,
        order: { select: { orderNumber: true } }
      }
    }),
    prisma.payment.findMany({
      where: { order: scope },
      orderBy: { paidAt: 'desc' },
      take: fetchLimit,
      select: {
        id: true,
        amount: true,
        paidAt: true,
        orderId: true,
        order: { select: { orderNumber: true } }
      }
    }),
    prisma.auditLog.findMany({
      where: {
        entity: 'order',
        action: { in: ['order_status_changed', 'comment_posted'] }
      },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit * 2,
      select: {
        id: true,
        action: true,
        entityId: true,
        createdAt: true,
        meta: true
      }
    }),
    prisma.comment.findMany({
      where: { order: scope },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
      select: {
        id: true,
        createdAt: true,
        body: true,
        orderId: true,
        author: { select: { name: true } },
        order: { select: { orderNumber: true } }
      }
    })
  ]);

  // Status-changed audits are not directly scoped via the OrderWhereInput; we
  // need to filter them to orders the manager can actually see.
  const auditEntityIds = Array.from(new Set(statusAudits.map((a) => a.entityId)));
  let scopedAuditOrderInfo = new Map<string, { orderNumber: string | null }>();
  if (auditEntityIds.length > 0) {
    const scopedOrders = await prisma.order.findMany({
      where: { AND: [scope, { id: { in: auditEntityIds } }] },
      select: { id: true, orderNumber: true }
    });
    scopedAuditOrderInfo = new Map(
      scopedOrders.map((o) => [o.id, { orderNumber: o.orderNumber }])
    );
  }

  const events: EventItem[] = [
    ...documents.map((d): EventItem => ({
      id: `doc-${d.id}`,
      kind: 'document_created',
      when: d.createdAt,
      text: `Загружен документ ${d.name} по заказу ${d.order.orderNumber ?? d.orderId}`,
      href: `/manager/orders/${d.orderId}`
    })),
    ...payments.map((p): EventItem => ({
      id: `pay-${p.id}`,
      kind: 'payment_received',
      when: p.paidAt,
      text: `Поступила оплата ${Number(p.amount).toFixed(0)} ₽ по заказу ${p.order.orderNumber ?? p.orderId}`,
      href: `/manager/orders/${p.orderId}`
    })),
    ...statusAudits
      .filter((a) => scopedAuditOrderInfo.has(a.entityId))
      .map((a): EventItem => {
        const info = scopedAuditOrderInfo.get(a.entityId);
        const meta = (a.meta as Record<string, unknown> | null) ?? null;
        const afterStatus =
          meta && typeof meta === 'object' && 'after' in meta
            ? ((meta.after as Record<string, unknown>)?.executionStatus as string | undefined)
            : undefined;
        const text =
          a.action === 'order_status_changed'
            ? `Заказ ${info?.orderNumber ?? a.entityId}: статус → ${afterStatus ?? '—'}`
            : `Новый комментарий в заказе ${info?.orderNumber ?? a.entityId}`;
        return {
          id: `audit-${a.id}`,
          kind: a.action,
          when: a.createdAt,
          text,
          href: `/manager/orders/${a.entityId}`
        };
      }),
    ...comments.map((c): EventItem => ({
      id: `comment-${c.id}`,
      kind: 'comment',
      when: c.createdAt,
      text: `${c.author?.name ?? 'Аноним'}: ${c.body.slice(0, 100)}`,
      href: `/manager/orders/${c.orderId}`
    }))
  ];

  events.sort((a, b) => b.when.getTime() - a.when.getTime());
  return events.slice(0, take);
}
