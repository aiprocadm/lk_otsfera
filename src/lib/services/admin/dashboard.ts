import type { PrismaClient } from '@prisma/client';
import { getSyncLag } from './syncHealth';
import { getDlq } from './queueStats';

export type KpiTile = {
  label: string;
  value: string | number;
  href: string;
  delta?: { value: number; positive: boolean };
};

export type AttentionItem = {
  id: string;
  title: string;
  href: string;
  severity: 'warn' | 'urgent';
};

export type EventItem = {
  id: string;
  actor: string;
  verb: string;
  entity: string;
  entityRef?: string;
  timestamp: Date;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * Actions that are meaningful to display in the admin event feed.
 * Only includes actions that are actually emitted by the current codebase.
 * Spec aliases (partner_created, user_role_changed, org_rate_override,
 * lead_promoted) are also kept here for forward-compatibility in case they
 * are introduced later.
 */
const TRACKED_ACTIONS = [
  // Commission lifecycle
  'commission_statement_calculated',
  'commission_statement_approved',
  'commission_statement_paid',
  // Partner rate override (actual action string from rateOverride.ts)
  'partner_commission_rate_changed',
  // Lead events
  'lead_created',
  'lead_withdrawn',
  // Partner membership
  'partner_member_invited',
  'partner_member_deactivated',
  'partner_member_scope_changed',
  // Forward-compat / spec aliases
  'partner_created',
  'partner_updated',
  'partner_deactivated',
  'user_role_changed',
  'org_rate_override',
  'organization_rate_override',
  'lead_promoted',
  'lead_promoted_to_order',
];

export async function kpis(prisma: PrismaClient): Promise<KpiTile[]> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY);

  const [
    partnersActive,
    partnersCreatedLast30,
    partnersCreatedPrev30,
    organizations,
    orgsCreatedLast30,
    orgsCreatedPrev30,
    closedOrdersThisMonth,
    closedOrdersSum,
    pendingPayouts,
  ] = await Promise.all([
    prisma.partner.count({ where: { isActive: true } }),
    prisma.partner.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.partner.count({ where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
    prisma.organization.count(),
    prisma.organization.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.organization.count({ where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
    prisma.order.count({ where: { closedAt: { gte: monthStart } } }),
    prisma.order.aggregate({
      where: { closedAt: { gte: monthStart } },
      _sum: { totalAmount: true },
    }),
    prisma.commissionStatement.aggregate({
      where: { status: 'approved' },
      _sum: { totalCommissionAmount: true },
    }),
  ]);

  const partnerDelta = partnersCreatedLast30 - partnersCreatedPrev30;
  const orgDelta = orgsCreatedLast30 - orgsCreatedPrev30;
  const orderTotal = Number(closedOrdersSum._sum.totalAmount ?? 0);
  const payoutTotal = Number(pendingPayouts._sum.totalCommissionAmount ?? 0);

  return [
    {
      label: 'Партнёры активные',
      value: partnersActive,
      href: '/admin/partners',
      delta: {
        value: partnerDelta,
        positive: partnersCreatedLast30 >= partnersCreatedPrev30,
      },
    },
    {
      label: 'Организации',
      value: organizations,
      href: '/admin/organizations',
      delta: {
        value: orgDelta,
        positive: orgsCreatedLast30 >= orgsCreatedPrev30,
      },
    },
    {
      label: 'Закрытые заказы (месяц)',
      value: `${closedOrdersThisMonth} (${orderTotal.toLocaleString('ru-RU')} ₽)`,
      href: '/admin/orders',
    },
    {
      label: 'К выплате партнёрам',
      value: `${payoutTotal.toLocaleString('ru-RU')} ₽`,
      href: '/admin/commission-statements',
    },
  ];
}

export async function attention(prisma: PrismaClient): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const now = Date.now();

  // 1. Sync lag per entity (>24h = warn, >48h = urgent)
  try {
    const lagRows = await getSyncLag(prisma);
    const lagging = lagRows.filter((r) => r.lagMs !== null && r.lagMs > DAY);
    if (lagging.length > 0) {
      const worst = lagging.reduce((a, b) => (a.lagMs! > b.lagMs! ? a : b));
      const urgent = worst.lagMs! > 2 * DAY;
      items.push({
        id: 'sync_lag',
        title: `Лаг синхронизации: ${lagging.length} сущ.`,
        href: '/admin/health',
        severity: urgent ? 'urgent' : 'warn',
      });
    }
  } catch {
    // getSyncLag may throw if DB or Redis is unavailable — degrade gracefully
  }

  // 2. DLQ jobs (any failed job = urgent)
  try {
    const dlq = await getDlq();
    if (dlq.length > 0) {
      items.push({
        id: 'dlq',
        title: `Упавшие задачи: ${dlq.length}`,
        href: '/admin/health',
        severity: 'urgent',
      });
    }
  } catch {
    // getDlq may throw if Redis is unavailable — degrade gracefully
  }

  // 3. Approved statements >7 days without paidAt
  const weekAgo = new Date(now - 7 * DAY);
  const oldApproved = await prisma.commissionStatement.count({
    where: {
      status: 'approved',
      approvedAt: { lt: weekAgo },
      paidAt: null,
    },
  });
  if (oldApproved > 0) {
    items.push({
      id: 'old_approved',
      title: `Утверждённые отчёты без выплаты: ${oldApproved}`,
      href: '/admin/commission-statements?status=approved',
      severity: 'warn',
    });
  }

  // 4. Active partners with commissionRate = 0
  const noRatePartners = await prisma.partner.count({
    where: { commissionRate: { equals: 0 }, isActive: true },
  });
  if (noRatePartners > 0) {
    items.push({
      id: 'no_rate',
      title: `Партнёры без ставки: ${noRatePartners}`,
      href: '/admin/partners?filter=norate',
      severity: 'warn',
    });
  }

  return items;
}

export async function recentEvents(
  prisma: PrismaClient,
  take = 20,
): Promise<EventItem[]> {
  const rows = await prisma.auditLog.findMany({
    where: { action: { in: TRACKED_ACTIONS } },
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    // AuditLog.user is nullable (the actor may have been deleted). Guard against
    // a TypeError that would 500 the whole admin dashboard — mirrors listAudit.
    actor: r.user?.name || r.user?.email || '—',
    verb: r.action,
    entity: r.entity,
    entityRef: r.entityId,
    timestamp: r.createdAt,
  }));
}
