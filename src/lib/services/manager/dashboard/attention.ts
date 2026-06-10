import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrderScope, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import {
  ONE_DAY_MS,
  THREE_DAYS_MS,
  FOURTEEN_DAYS_MS,
  ATTENTION_CAP_PER_SOURCE,
  TERMINAL_EXEC,
} from './constants';

export type AttentionItem = {
  id: string;
  kind: string;
  severity: 'warn' | 'urgent';
  message: string;
  href: string;
};

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
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const scope = managerOrderScope(session, teamMode);
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
          // orderId: { not: null } — order-less docs must not enter this order-centric feed
          orderId: { not: null },
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
      message: `Акт «${d.name}» >3 дней без подписи${d.order?.orderNumber ? ` (заказ ${d.order.orderNumber})` : ''}`,
      href: d.orderId ? `/manager/orders/${d.orderId}` : '/manager/documents'
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
