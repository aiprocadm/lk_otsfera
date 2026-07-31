import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  managerOrderScope,
  managerOrgScope,
  getCompanyTeamVisibility,
} from '@/lib/auth/managerPolicy';
import { fmtMoney } from '@/lib/format';
import { DEFAULT_EVENTS } from './constants';

export type EventItem = {
  id: string;
  kind: string;
  when: Date;
  text: string;
  href?: string;
};

/**
 * Recent events merged from documents, payments, status-change audit log
 * entries, and comments. All scoped via `managerOrderScopeFilter` so that
 * an event for an out-of-scope order is never emitted. Sorted by timestamp
 * desc and sliced to `take`.
 */
export async function recentEvents(
  prisma: PrismaClient,
  session: SessionPayload,
  take = DEFAULT_EVENTS,
  teamModeOverride?: boolean
): Promise<EventItem[]> {
  const teamMode = teamModeOverride ?? (await getCompanyTeamVisibility(prisma, session.companyId));
  const scope = managerOrderScope(session, teamMode);
  const orgScope = managerOrgScope(session, teamMode);
  const fetchLimit = Math.max(20, take);

  const [documents, payments, statusAudits, comments] = await Promise.all([
    prisma.document.findMany({
      // orderId: { not: null } — order-less docs must not enter this order-centric feed
      where: { order: scope, scanStatus: { not: 'infected' }, orderId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
      select: {
        id: true,
        name: true,
        createdAt: true,
        orderId: true,
        order: { select: { orderNumber: true } },
      },
    }),
    prisma.payment.findMany({
      where: { organization: orgScope },
      orderBy: { paidAt: 'desc' },
      take: fetchLimit,
      select: {
        id: true,
        amount: true,
        paidAt: true,
        orderId: true,
        order: { select: { orderNumber: true } },
        organization: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: {
        entity: 'order',
        action: { in: ['order_status_changed', 'comment_posted'] },
      },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit * 2,
      select: {
        id: true,
        action: true,
        entityId: true,
        createdAt: true,
        meta: true,
      },
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
        order: { select: { orderNumber: true } },
      },
    }),
  ]);

  // Status-changed audits are not directly scoped via the OrderWhereInput; we
  // need to filter them to orders the manager can actually see.
  const auditEntityIds = Array.from(new Set(statusAudits.map((a) => a.entityId)));
  let scopedAuditOrderInfo = new Map<string, { orderNumber: string | null }>();
  if (auditEntityIds.length > 0) {
    const scopedOrders = await prisma.order.findMany({
      where: { AND: [scope, { id: { in: auditEntityIds } }] },
      select: { id: true, orderNumber: true },
    });
    scopedAuditOrderInfo = new Map(scopedOrders.map((o) => [o.id, { orderNumber: o.orderNumber }]));
  }

  const events: EventItem[] = [
    ...documents.map((d): EventItem => ({
      id: `doc-${d.id}`,
      kind: 'document_created',
      when: d.createdAt,
      text: `Загружен документ ${d.name}${d.order?.orderNumber ? ` по заказу ${d.order.orderNumber}` : ''}`,
      href: d.orderId ? `/manager/orders/${d.orderId}` : '/manager/documents',
    })),
    ...payments.map((p): EventItem =>
      p.order
        ? {
            id: `pay-${p.id}`,
            kind: 'payment_received',
            when: p.paidAt,
            text: `Поступила оплата ${fmtMoney(Number(p.amount))} по заказу ${p.order.orderNumber ?? p.orderId}`,
            href: `/manager/orders/${p.orderId}`,
          }
        : {
            id: `pay-${p.id}`,
            kind: 'payment_received',
            when: p.paidAt,
            text: `Поступила оплата ${fmtMoney(Number(p.amount))} (организация ${p.organization.name})`,
            href: `/manager/dashboard`,
          }
    ),
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
          href: `/manager/orders/${a.entityId}`,
        };
      }),
    ...comments.map((c): EventItem => ({
      id: `comment-${c.id}`,
      kind: 'comment',
      when: c.createdAt,
      text: `${c.author?.name ?? 'Аноним'}: ${c.body.slice(0, 100)}`,
      href: `/manager/orders/${c.orderId}`,
    })),
  ];

  events.sort((a, b) => b.when.getTime() - a.when.getTime());
  return events.slice(0, take);
}
