import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { fmtMoney } from '@/lib/format';

export type DashboardScope = {
  partnerId: string;
  scopeOrgIds: string[]; // [] = весь партнёр
};

export type Kpis = {
  openOrders: number;
  outstanding: string;
  activeLeads: number;
  commissionThisMonth: string;
};

function orderWhereForScope(scope: DashboardScope) {
  // F2: a partner sees an order ONLY through its own lead
  // (Order.promotedFromLead → Lead.partnerId), not the legacy direct Order.partnerId.
  const base: {
    promotedFromLead: { partnerId: string };
    organizationId?: { in: string[] };
  } = { promotedFromLead: { partnerId: scope.partnerId } };

  if (scope.scopeOrgIds.length > 0) {
    base.organizationId = { in: scope.scopeOrgIds };
  }
  return base;
}

/**
 * Org-level filter mirroring orderWhereForScope but for org-owned rows
 * (e.g. order-less payments imported from 1C). Same partner boundary + the
 * same optional scopeOrgIds narrowing, so visibility stays identical.
 */
function orgWhereForScope(scope: DashboardScope) {
  const base: { partnerId: string; id?: { in: string[] } } = {
    partnerId: scope.partnerId
  };
  if (scope.scopeOrgIds.length > 0) {
    base.id = { in: scope.scopeOrgIds };
  }
  return base;
}

function startOfThisMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function startOfNextMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
}

export async function kpis(
  prisma: PrismaClient,
  scope: DashboardScope
): Promise<Kpis> {
  const baseWhere = orderWhereForScope(scope);

  const partner = await prisma.partner.findUnique({
    where: { id: scope.partnerId },
    select: { commissionRate: true }
  });
  const rate = partner?.commissionRate ?? new Prisma.Decimal(0);

  const [openOrders, outstandingOrders, activeLeads, paidThisMonth] = await Promise.all([
    prisma.order.count({
      where: { ...baseWhere, executionStatus: { in: ['pending', 'in_progress'] } }
    }),
    prisma.order.findMany({
      where: { ...baseWhere, executionStatus: { not: 'cancelled' } },
      select: { totalAmount: true, paidAmount: true }
    }),
    prisma.lead.count({
      where: {
        partnerId: scope.partnerId,
        status: { in: ['new', 'in_review', 'qualified'] }
      }
    }),
    prisma.order.findMany({
      where: {
        ...baseWhere,
        financialStatus: 'paid',
        paidAt: { gte: startOfThisMonth(), lt: startOfNextMonth() }
      },
      select: { totalAmount: true }
    })
  ]);

  // Деньги — на Decimal (канон §1 ТЗ): накопление сумм и умножение на ставку
  // не должны проходить через JS number.
  const outstanding = outstandingOrders.reduce(
    (sum, o) => sum.plus(o.totalAmount).minus(o.paidAmount),
    new Prisma.Decimal(0)
  );
  const commission = paidThisMonth.reduce(
    (sum, o) => sum.plus(o.totalAmount.mul(rate)),
    new Prisma.Decimal(0)
  );

  return {
    openOrders,
    outstanding: outstanding.toFixed(2),
    activeLeads,
    commissionThisMonth: commission.toFixed(2)
  };
}

// ─── T9: Attention ─────────────────────────────────────────────────────────

const FOURTEEN_DAYS_MS = 14 * 24 * 3600 * 1000;
const FIVE_DAYS_MS = 5 * 24 * 3600 * 1000;
const ATTENTION_CAP = 10;

export type AttentionOrder = {
  id: string;
  title: string;
  updatedAt: Date;
  deadline: Date | null;
  totalAmount: string;
  paidAmount: string;
};

export type AttentionLead = {
  id: string;
  clientCompanyName: string;
  subject: string;
  createdAt: Date;
};

export type Attention = {
  stuckOrders: AttentionOrder[];
  overdueOrders: AttentionOrder[];
  staleLeads: AttentionLead[];
};

export async function attention(
  prisma: PrismaClient,
  scope: DashboardScope
): Promise<Attention> {
  const baseWhere = orderWhereForScope(scope);
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - FOURTEEN_DAYS_MS);
  const fiveDaysAgo = new Date(now.getTime() - FIVE_DAYS_MS);

  const [stuck, overdue, stale] = await Promise.all([
    prisma.order.findMany({
      where: {
        ...baseWhere,
        executionStatus: { in: ['pending', 'in_progress'] },
        updatedAt: { lt: fourteenDaysAgo }
      },
      orderBy: { updatedAt: 'asc' },
      take: ATTENTION_CAP,
      select: { id: true, title: true, updatedAt: true, deadline: true, totalAmount: true, paidAmount: true }
    }),
    prisma.order.findMany({
      where: {
        ...baseWhere,
        executionStatus: { not: 'cancelled' },
        financialStatus: { in: ['billed', 'partially_paid'] },
        deadline: { lt: now }
      },
      orderBy: { deadline: 'asc' },
      take: ATTENTION_CAP,
      select: { id: true, title: true, updatedAt: true, deadline: true, totalAmount: true, paidAmount: true }
    }),
    prisma.lead.findMany({
      where: {
        partnerId: scope.partnerId,
        status: 'new',
        createdAt: { lt: fiveDaysAgo }
      },
      orderBy: { createdAt: 'asc' },
      take: ATTENTION_CAP,
      select: { id: true, clientCompanyName: true, subject: true, createdAt: true }
    })
  ]);

  return {
    stuckOrders: stuck.map((o) => ({
      ...o,
      totalAmount: Number(o.totalAmount).toFixed(2),
      paidAmount: Number(o.paidAmount).toFixed(2)
    })),
    overdueOrders: overdue.map((o) => ({
      ...o,
      totalAmount: Number(o.totalAmount).toFixed(2),
      paidAmount: Number(o.paidAmount).toFixed(2)
    })),
    staleLeads: stale
  };
}

// ─── T10: Recent Events ─────────────────────────────────────────────────────

export type EventKind = 'order_updated' | 'lead_created' | 'payment_received';

export type DashboardEvent = {
  kind: EventKind;
  at: Date;
  title: string;
  // Order-less payments (org-level, imported from 1C) have no order/lead target.
  ref?: { kind: 'order' | 'lead'; id: string };
};

export async function recentEvents(
  prisma: PrismaClient,
  scope: DashboardScope,
  limit: number
): Promise<DashboardEvent[]> {
  const baseWhere = orderWhereForScope(scope);

  const [orders, leads, payments] = await Promise.all([
    prisma.order.findMany({
      where: baseWhere,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, title: true, updatedAt: true }
    }),
    prisma.lead.findMany({
      where: { partnerId: scope.partnerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, clientCompanyName: true, subject: true, createdAt: true }
    }),
    prisma.payment.findMany({
      where: { organization: orgWhereForScope(scope) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, amount: true, createdAt: true,
        order: { select: { id: true, title: true } },
        organization: { select: { id: true, name: true } }
      }
    })
  ]);

  const events: DashboardEvent[] = [
    ...orders.map((o): DashboardEvent => ({
      kind: 'order_updated',
      at: o.updatedAt,
      title: `Заказ «${o.title}» обновлён`,
      ref: { kind: 'order', id: o.id }
    })),
    ...leads.map((l): DashboardEvent => ({
      kind: 'lead_created',
      at: l.createdAt,
      title: `Новый лид: ${l.clientCompanyName} — ${l.subject}`,
      ref: { kind: 'lead', id: l.id }
    })),
    ...payments.map((p): DashboardEvent =>
      p.order
        ? {
            kind: 'payment_received',
            at: p.createdAt,
            title: `Оплата ${fmtMoney(Number(p.amount))} по заказу «${p.order.title}»`,
            ref: { kind: 'order', id: p.order.id }
          }
        : {
            kind: 'payment_received',
            at: p.createdAt,
            title: `Оплата ${fmtMoney(Number(p.amount))} (организация ${p.organization.name})`
          }
    )
  ];

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events.slice(0, limit);
}
