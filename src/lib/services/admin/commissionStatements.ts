import type { PrismaClient, CommissionStatement, Prisma } from '@prisma/client';

export type AdminStatementRow = CommissionStatement & {
  itemCount: number;
  partner: { id: string; name: string; slug: string | null };
};

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
export type ListAdminStatementsOptions = {
  status?: 'draft' | 'approved' | 'paid' | undefined;
  partnerId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  skip?: number | undefined;
  take?: number | undefined;
};

/**
 * Cross-partner listing for the platform admin. By default returns approved
 * and paid statements (the lifecycle states an admin can act on); explicit
 * `status` overrides include drafts when needed for inspection.
 */
export async function listAdminStatements(
  prisma: PrismaClient,
  opts: ListAdminStatementsOptions = {}
): Promise<AdminStatementRow[]> {
  const { status, partnerId, from, to, skip = 0, take = 50 } = opts;

  const where: Prisma.CommissionStatementWhereInput = {
    supersededBy: null,
    status: status ?? { in: ['approved', 'paid'] },
  };
  if (partnerId) where.partnerId = partnerId;
  if (from || to) {
    where.periodFrom = {};
    if (from) (where.periodFrom as Prisma.DateTimeFilter).gte = from;
    if (to) (where.periodFrom as Prisma.DateTimeFilter).lte = to;
  }

  const rows = await prisma.commissionStatement.findMany({
    where,
    orderBy: [{ status: 'asc' }, { periodFrom: 'desc' }],
    skip,
    take,
    include: {
      _count: { select: { items: true } },
      partner: { select: { id: true, name: true, slug: true } },
    },
  });

  return rows.map(({ _count, partner, ...s }) => ({
    ...s,
    itemCount: _count.items,
    partner,
  }));
}

export async function getAdminStatement(prisma: PrismaClient, statementId: string) {
  return prisma.commissionStatement.findUnique({
    where: { id: statementId },
    include: {
      items: { orderBy: { organizationName: 'asc' } },
      partner: { select: { id: true, name: true, slug: true } },
    },
  });
}

export type StatementAuditEntry = {
  id: string;
  action: string;
  createdAt: Date;
  userId: string;
  userName: string | null;
  meta: Prisma.JsonValue | null;
};

/**
 * Returns the audit trail for one commission statement (calculated/approved/
 * paid). Used by the admin detail page to show "what happened, when, by whom".
 */
export async function getStatementAuditLog(
  prisma: PrismaClient,
  statementId: string
): Promise<StatementAuditEntry[]> {
  const entries = await prisma.auditLog.findMany({
    where: {
      // Writers (lifecycle.ts, statement.ts, seed.ts) all use the snake_case
      // entity string; querying 'CommissionStatement' matched nothing, leaving
      // the admin statement audit trail permanently empty.
      entity: 'commission_statement',
      entityId: statementId,
    },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { name: true } } },
  });

  return entries.map((e) => ({
    id: e.id,
    action: e.action,
    createdAt: e.createdAt,
    userId: e.userId,
    userName: e.user?.name ?? null,
    meta: e.meta,
  }));
}

export type ListPartnersForFilterRow = { id: string; name: string };

export async function listPartnersForFilter(
  prisma: PrismaClient
): Promise<ListPartnersForFilterRow[]> {
  return prisma.partner.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}
