import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { organizationChannelWhere } from '@/lib/auth/documentChannelPolicy';
import { fmtMoney } from '@/lib/format';

export type OrgDashboardKpis = {
  activeOrders: number;
  outstandingAmount: string;
  studentsCount: number;
  recentDocumentsCount: number;
};

export type OrgAttentionItem = {
  id: string;
  kind: 'billed_unpaid' | 'unsigned_act' | 'completed_open';
  orderId: string | null;
  title: string;
  meta?: string;
  severity: 'warn' | 'urgent';
};

export type OrgAttention = {
  items: OrgAttentionItem[];
};

export type OrgEvent = {
  id: string;
  kind: 'document_published' | 'payment_received' | 'order_status_changed' | 'comment_posted';
  orderId: string | null;
  title: string;
  at: Date;
};

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
        ...organizationChannelWhere(organizationId),
        createdAt: { gte: since30 }
      }
    })
  ]);

  const outstanding = outstandingOrders.reduce(
    (sum, o) => sum.plus(o.totalAmount).minus(o.paidAmount),
    new Prisma.Decimal(0)
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
    // orderId: { not: null } — order-less docs must not enter this order-centric feed
    prisma.document.findMany({
      where: {
        ...organizationChannelWhere(organizationId),
        type: 'act',
        signedAt: null,
        createdAt: { lt: threeDaysAgo },
        orderId: { not: null }
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
      meta: fmtMoney(o.totalAmount.minus(o.paidAmount).toNumber()),
      severity: 'urgent'
    })),
    ...unsignedActs.map((d): OrgAttentionItem => ({
      id: `act-${d.id}`,
      kind: 'unsigned_act',
      orderId: d.orderId,
      title: `Акт «${d.name}» требует подписания`,
      meta: d.order?.orderNumber ?? undefined,
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
      where: { ...organizationChannelWhere(organizationId), orderId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
      select: { id: true, name: true, createdAt: true, orderId: true }
    }),
    prisma.payment.findMany({
      where: { organizationId },
      orderBy: { paidAt: 'desc' },
      take: fetchLimit,
      select: { id: true, amount: true, paidAt: true, orderId: true }
    }),
    // AuditLog не имеет relation к Order (entityId — строка), поэтому скоуп —
    // raw-join. Раньше бралась ГЛОБАЛЬНАЯ верхушка fetchLimit*2 с пост-фильтром
    // по заказам организации: активный соседний тенант вытеснял события текущего
    // из окна (starvation), и приложение читало чужие строки впустую.
    prisma.$queryRaw<Array<{ id: string; entityId: string; createdAt: Date }>>`
      SELECT a."id", a."entityId", a."createdAt"
      FROM "AuditLog" a
      JOIN "Order" o ON o."id" = a."entityId"
      WHERE a."entity" = 'order'
        AND a."action" LIKE 'order_status_%'
        AND o."organizationId" = ${organizationId}
      ORDER BY a."createdAt" DESC
      LIMIT ${fetchLimit}
    `,
    prisma.comment.findMany({
      where: { order: { organizationId } },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
      select: { id: true, createdAt: true, orderId: true, body: true }
    })
  ]);

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
      title: `Получена оплата ${fmtMoney(Number(p.amount))}`,
      at: p.paidAt
    })),
    ...statusAudits.map((a): OrgEvent => ({
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

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events.slice(0, take);
}
