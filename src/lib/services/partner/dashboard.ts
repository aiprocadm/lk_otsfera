import { Prisma } from '@prisma/client';
import type { PrismaClient, EnrollmentStatus } from '@prisma/client';
import { fmtMoney } from '@/lib/format';
import { EXPIRING_WITHIN_DAYS } from '@/lib/services/training/certificates';

export type DashboardScope = {
  partnerId: string;
  scopeOrgIds: string[]; // [] = весь партнёр
};

export type Kpis = {
  openOrders: number;
  outstanding: string;
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
    partnerId: scope.partnerId,
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

export async function kpis(prisma: PrismaClient, scope: DashboardScope): Promise<Kpis> {
  const baseWhere = orderWhereForScope(scope);

  const partner = await prisma.partner.findUnique({
    where: { id: scope.partnerId },
    select: { commissionRate: true },
  });
  const rate = partner?.commissionRate ?? new Prisma.Decimal(0);

  const [openOrders, outstandingAgg, paidThisMonth] = await Promise.all([
    prisma.order.count({
      where: { ...baseWhere, executionStatus: { in: ['pending', 'in_progress'] } },
    }),
    // Сумма линейна → SQL SUM вместо выборки всех строк в JS (R2).
    prisma.order.aggregate({
      where: { ...baseWhere, executionStatus: { not: 'cancelled' } },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    prisma.order.findMany({
      where: {
        ...baseWhere,
        financialStatus: 'paid',
        paidAt: { gte: startOfThisMonth(), lt: startOfNextMonth() },
      },
      select: { totalAmount: true, organization: { select: { partnerCommissionRate: true } } },
    }),
  ]);

  // Деньги — на Decimal (канон §1 ТЗ): накопление сумм и умножение на ставку
  // не должны проходить через JS number. _sum приходит Decimal'ом (или null
  // при нуле строк).
  const outstanding = (outstandingAgg._sum.totalAmount ?? new Prisma.Decimal(0)).minus(
    outstandingAgg._sum.paidAmount ?? new Prisma.Decimal(0)
  );
  // §6.2 ТЗ: приоритет ставки — индивидуальная ставка организации (договорная
  // скидка) → дефолт партнёра. Историческая ставка по дате платежа тут
  // сознательно не применяется: это live-оценка по заказам (та же семантика,
  // что у getOrgIntermediaryCommission), а не канонический стейтмент.
  const commission = paidThisMonth.reduce(
    (sum, o) => sum.plus(o.totalAmount.mul(o.organization.partnerCommissionRate ?? rate)),
    new Prisma.Decimal(0)
  );

  return {
    openOrders,
    outstanding: outstanding.toFixed(2),
    commissionThisMonth: commission.toFixed(2),
  };
}

// ─── T9: Attention ─────────────────────────────────────────────────────────

const FOURTEEN_DAYS_MS = 14 * 24 * 3600 * 1000;
const ATTENTION_CAP = 10;

export type AttentionOrder = {
  id: string;
  title: string;
  updatedAt: Date;
  deadline: Date | null;
  totalAmount: string;
  paidAmount: string;
};

export type Attention = {
  stuckOrders: AttentionOrder[];
  overdueOrders: AttentionOrder[];
};

export async function attention(prisma: PrismaClient, scope: DashboardScope): Promise<Attention> {
  const baseWhere = orderWhereForScope(scope);
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - FOURTEEN_DAYS_MS);

  const [stuck, overdue] = await Promise.all([
    prisma.order.findMany({
      where: {
        ...baseWhere,
        executionStatus: { in: ['pending', 'in_progress'] },
        updatedAt: { lt: fourteenDaysAgo },
      },
      orderBy: { updatedAt: 'asc' },
      take: ATTENTION_CAP,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        deadline: true,
        totalAmount: true,
        paidAmount: true,
      },
    }),
    prisma.order.findMany({
      where: {
        ...baseWhere,
        executionStatus: { not: 'cancelled' },
        financialStatus: { in: ['billed', 'partially_paid'] },
        deadline: { lt: now },
      },
      orderBy: { deadline: 'asc' },
      take: ATTENTION_CAP,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        deadline: true,
        totalAmount: true,
        paidAmount: true,
      },
    }),
  ]);

  return {
    stuckOrders: stuck.map((o) => ({
      ...o,
      totalAmount: Number(o.totalAmount).toFixed(2),
      paidAmount: Number(o.paidAmount).toFixed(2),
    })),
    overdueOrders: overdue.map((o) => ({
      ...o,
      totalAmount: Number(o.totalAmount).toFixed(2),
      paidAmount: Number(o.paidAmount).toFixed(2),
    })),
  };
}

// ─── T10: Recent Events ─────────────────────────────────────────────────────

export type EventKind = 'order_updated' | 'payment_received';

export type DashboardEvent = {
  kind: EventKind;
  at: Date;
  title: string;
  // Order-less payments (org-level, imported from 1C) have no order target.
  ref?: { kind: 'order'; id: string };
};

export async function recentEvents(
  prisma: PrismaClient,
  scope: DashboardScope,
  limit: number
): Promise<DashboardEvent[]> {
  const baseWhere = orderWhereForScope(scope);

  const [orders, payments] = await Promise.all([
    prisma.order.findMany({
      where: baseWhere,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, title: true, updatedAt: true },
    }),
    prisma.payment.findMany({
      where: { organization: orgWhereForScope(scope) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        amount: true,
        createdAt: true,
        order: { select: { id: true, title: true } },
        organization: { select: { id: true, name: true } },
      },
    }),
  ]);

  const events: DashboardEvent[] = [
    ...orders.map((o): DashboardEvent => ({
      kind: 'order_updated',
      at: o.updatedAt,
      title: `Заказ «${o.title}» обновлён`,
      ref: { kind: 'order', id: o.id },
    })),
    ...payments.map((p): DashboardEvent =>
      p.order
        ? {
            kind: 'payment_received',
            at: p.createdAt,
            title: `Оплата ${fmtMoney(Number(p.amount))} по заказу «${p.order.title}»`,
            ref: { kind: 'order', id: p.order.id },
          }
        : {
            kind: 'payment_received',
            at: p.createdAt,
            title: `Оплата ${fmtMoney(Number(p.amount))} (организация ${p.organization.name})`,
          }
    ),
  ];

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events.slice(0, limit);
}

export type PartnerEnrollmentSummary = {
  id: string;
  directionName: string;
  studentCount: number;
  status: EnrollmentStatus;
  createdAt: Date;
};

/**
 * Последние заявки на обучение партнёра для дашборда (этап 2 PR-2, ФТ-2.4).
 * Граница — partnerId заявки (как в списке заявок), плюс scopeOrgIds-сужение
 * как у остальных блоков дашборда. Только шапки — без ПДн слушателей.
 */
export async function recentEnrollments(
  prisma: PrismaClient,
  scope: DashboardScope,
  take = 5
): Promise<PartnerEnrollmentSummary[]> {
  const where: { partnerId: string; organizationId?: { in: string[] } } = {
    partnerId: scope.partnerId,
  };
  if (scope.scopeOrgIds.length > 0) {
    where.organizationId = { in: scope.scopeOrgIds };
  }
  const rows = await prisma.enrollmentRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      status: true,
      createdAt: true,
      legacyCourseTitle: true,
      direction: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    directionName: r.direction?.name ?? r.legacyCourseTitle ?? '—',
    studentCount: r._count.items,
    status: r.status,
    createdAt: r.createdAt,
  }));
}

/**
 * KPI «Истекают удостоверения: N» (этап 3, ФТ-6.4): не-истёкшие со сроком
 * ≤ 60 дней по организациям в скоупе партнёра (orgWhereForScope — та же
 * граница, что у остальных блоков дашборда).
 */
export async function expiringCertificates(
  prisma: PrismaClient,
  scope: DashboardScope,
  now: Date = new Date()
): Promise<number> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const horizon = new Date(startOfToday.getTime() + EXPIRING_WITHIN_DAYS * 24 * 3600 * 1000);
  return prisma.certificate.count({
    where: {
      organization: orgWhereForScope(scope),
      validUntil: { gte: startOfToday, lte: horizon },
    },
  });
}
