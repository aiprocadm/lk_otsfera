import type { PrismaClient } from '@prisma/client';
import type { OrgDashboardKpis } from '@/components/organization/org-kpi-grid';
import type { OrgAttention, OrgAttentionItem } from '@/components/organization/org-attention-list';
import type { OrgEvent } from '@/components/organization/org-events-feed';

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
const THREE_DAYS_MS = 3 * 24 * 3600 * 1000;
const ATTENTION_CAP = 10;
const DEFAULT_EVENTS = 15;

export async function kpis(
  prisma: PrismaClient,
  organizationId: string
): Promise<OrgDashboardKpis> {
  const since30 = new Date(Date.now() - THIRTY_DAYS_MS);

  const [activeOrders, outstandingOrders, studentsCount, recentDocumentsCount] = await Promise.all([
    prisma.order.count({
      where: {
        organizationId,
        executionStatus: { in: ['pending', 'in_progress'] }
      }
    }),
    prisma.order.findMany({
      where: {
        organizationId,
        financialStatus: { in: ['billed', 'partially_paid'] }
      },
      select: { totalAmount: true, paidAmount: true }
    }),
    prisma.student.count({ where: { organizationId } }),
    prisma.document.count({
      where: {
        order: { organizationId },
        createdAt: { gte: since30 },
        scanStatus: { not: 'infected' }
      }
    })
  ]);

  const outstanding = outstandingOrders.reduce(
    (sum, o) => sum + Number(o.totalAmount) - Number(o.paidAmount),
    0
  );

  return {
    activeOrders,
    outstandingAmount: outstanding.toFixed(2),
    studentsCount,
    recentDocumentsCount
  };
}

export async function attention(
  prisma: PrismaClient,
  organizationId: string
): Promise<OrgAttention> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);
  const threeDaysAgo = new Date(now.getTime() - THREE_DAYS_MS);

  const [billedUnpaid, unsignedActs, completedOpen] = await Promise.all([
    // Billed but not yet paid, billed more than 7 days ago (proxy: updatedAt)
    prisma.order.findMany({
      where: {
        organizationId,
        executionStatus: { in: ['pending', 'in_progress'] },
        financialStatus: { in: ['billed', 'partially_paid'] },
        updatedAt: { lt: sevenDaysAgo }
      },
      orderBy: { updatedAt: 'asc' },
      take: ATTENTION_CAP,
      select: { id: true, orderNumber: true, title: true, totalAmount: true, paidAmount: true }
    }),
    // Acts pending signature: created more than 3 days ago and not signed
    prisma.document.findMany({
      where: {
        order: { organizationId },
        type: 'act',
        signedAt: null,
        createdAt: { lt: threeDaysAgo },
        scanStatus: { not: 'infected' }
      },
      orderBy: { createdAt: 'asc' },
      take: ATTENTION_CAP,
      select: { id: true, name: true, orderId: true, order: { select: { orderNumber: true } } }
    }),
    // Completed orders but not yet closed
    prisma.order.findMany({
      where: {
        organizationId,
        executionStatus: 'completed',
        closedAt: null
      },
      orderBy: { updatedAt: 'asc' },
      take: ATTENTION_CAP,
      select: { id: true, orderNumber: true, title: true }
    })
  ]);

  const items: OrgAttentionItem[] = [
    ...billedUnpaid.map((o): OrgAttentionItem => ({
      id: `billed-${o.id}`,
      kind: 'billed_unpaid',
      orderId: o.id,
      title: `Счёт по заказу ${o.orderNumber ?? o.title} ждёт оплаты`,
      meta: `${(Number(o.totalAmount) - Number(o.paidAmount)).toFixed(0)} ₽`,
      severity: 'urgent'
    })),
    ...unsignedActs.map((d): OrgAttentionItem => ({
      id: `act-${d.id}`,
      kind: 'unsigned_act',
      orderId: d.orderId,
      title: `Акт «${d.name}» требует подписания`,
      meta: d.order.orderNumber ?? undefined,
      severity: 'warn'
    })),
    ...completedOpen.map((o): OrgAttentionItem => ({
      id: `closed-${o.id}`,
      kind: 'completed_open',
      orderId: o.id,
      title: `Заказ ${o.orderNumber ?? o.title} выполнен — закрыть`,
      severity: 'warn'
    }))
  ];

  return { items };
}

export async function recentEvents(
  prisma: PrismaClient,
  organizationId: string,
  take: number = DEFAULT_EVENTS
): Promise<OrgEvent[]> {
  const fetchLimit = Math.max(20, take);

  const [documents, payments, statusAudits, comments] = await Promise.all([
    prisma.document.findMany({
      where: { order: { organizationId }, scanStatus: { not: 'infected' } },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
      select: { id: true, name: true, createdAt: true, orderId: true }
    }),
    prisma.payment.findMany({
      where: { order: { organizationId } },
      orderBy: { paidAt: 'desc' },
      take: fetchLimit,
      select: { id: true, amount: true, paidAt: true, orderId: true }
    }),
    prisma.auditLog.findMany({
      where: { entity: 'order', action: { startsWith: 'order_status_' } },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit * 2,
      select: { id: true, entityId: true, createdAt: true, meta: true }
    }),
    prisma.comment.findMany({
      where: { order: { organizationId } },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
      select: { id: true, createdAt: true, orderId: true, body: true }
    })
  ]);

  // Filter audits to ones that belong to our organization's orders
  const orderIds = new Set([
    ...documents.map((d) => d.orderId),
    ...payments.map((p) => p.orderId),
    ...comments.map((c) => c.orderId)
  ]);
  const auditOrderIds = statusAudits.map((a) => a.entityId);
  const ordersForAudit = auditOrderIds.length
    ? await prisma.order.findMany({
        where: { id: { in: auditOrderIds }, organizationId },
        select: { id: true }
      })
    : [];
  const orgOrderIds = new Set(ordersForAudit.map((o) => o.id));

  const events: OrgEvent[] = [
    ...documents.map((d): OrgEvent => ({
      id: `doc-${d.id}`,
      kind: 'document_published',
      orderId: d.orderId,
      title: `Загружен документ «${d.name}»`,
      at: d.createdAt
    })),
    ...payments.map((p): OrgEvent => ({
      id: `pay-${p.id}`,
      kind: 'payment_received',
      orderId: p.orderId,
      title: `Получена оплата ${Number(p.amount).toFixed(0)} ₽`,
      at: p.paidAt
    })),
    ...statusAudits
      .filter((a) => orgOrderIds.has(a.entityId))
      .map((a): OrgEvent => ({
        id: `audit-${a.id}`,
        kind: 'order_status_changed',
        orderId: a.entityId,
        title: 'Статус заказа изменён',
        at: a.createdAt
      })),
    ...comments.map((c): OrgEvent => ({
      id: `comment-${c.id}`,
      kind: 'comment_posted',
      orderId: c.orderId,
      title: `Комментарий: ${c.body.slice(0, 80)}${c.body.length > 80 ? '…' : ''}`,
      at: c.createdAt
    }))
  ];

  // Touch orderIds for lint (used by future enrichment); for now we keep
  // documents/payments/comments already-scoped via where clause.
  void orderIds;

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events.slice(0, take);
}
