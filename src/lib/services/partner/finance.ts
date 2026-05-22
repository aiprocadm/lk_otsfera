import type { PrismaClient, CommissionStatement, Prisma } from '@prisma/client';

export type FinanceKpis = {
  earnedTotal: number;
  pendingTotal: number;
  paidTotal: number;
};

export type StatementListItem = CommissionStatement & {
  itemCount: number;
};

export async function getFinanceKpis(
  prisma: PrismaClient,
  partnerId: string
): Promise<FinanceKpis> {
  const statements = await prisma.commissionStatement.findMany({
    where: { partnerId, supersededBy: null },
    select: { status: true, totalCommissionAmount: true }
  });

  let earnedTotal = 0;
  let pendingTotal = 0;
  let paidTotal = 0;

  for (const s of statements) {
    const amount = Number(s.totalCommissionAmount);
    if (s.status === 'approved' || s.status === 'paid') earnedTotal += amount;
    if (s.status === 'draft' || s.status === 'approved') pendingTotal += amount;
    if (s.status === 'paid') paidTotal += amount;
  }

  return { earnedTotal, pendingTotal, paidTotal };
}

export type ListStatementsOptions = {
  partnerId: string;
  status?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
};

export async function listStatements(
  prisma: PrismaClient,
  opts: ListStatementsOptions
): Promise<StatementListItem[]> {
  const { partnerId, status, from, to, skip = 0, take = 20 } = opts;

  const where: Prisma.CommissionStatementWhereInput = {
    partnerId,
    supersededBy: null
  };
  if (status) where.status = status as CommissionStatement['status'];
  if (from || to) {
    where.periodFrom = {};
    if (from) (where.periodFrom as Prisma.DateTimeFilter).gte = from;
    if (to) (where.periodFrom as Prisma.DateTimeFilter).lte = to;
  }

  const rows = await prisma.commissionStatement.findMany({
    where,
    orderBy: { periodFrom: 'desc' },
    skip,
    take,
    include: { _count: { select: { items: true } } }
  });

  return rows.map(({ _count, ...s }) => ({ ...s, itemCount: _count.items }));
}

export async function getStatementWithItems(
  prisma: PrismaClient,
  statementId: string,
  partnerId: string
) {
  return prisma.commissionStatement.findFirst({
    where: { id: statementId, partnerId },
    include: { items: { orderBy: { organizationName: 'asc' } } }
  });
}
