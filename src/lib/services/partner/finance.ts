import type { PrismaClient, CommissionStatement, Prisma } from '@prisma/client';

export type FinanceKpis = {
  earnedTotal: number;
  pendingTotal: number;
  paidTotal: number;
};

// RSC-safe DTO: Prisma.Decimal is a class instance and cannot cross the
// Server→Client component boundary (Next would throw "Decimal objects are not
// supported"). Mirror the DealRow pattern in partner/deals.ts — serialize the
// Decimal to a fixed-precision string at the service boundary so the page can
// hand it straight to the client list.
export type StatementListItem = {
  id: string;
  periodFrom: Date;
  periodTo: Date;
  status: CommissionStatement['status'];
  totalCommissionAmount: string;
  pdfPath: string | null;
  xlsxPath: string | null;
  itemCount: number;
};

export async function getFinanceKpis(
  prisma: PrismaClient,
  partnerId: string
): Promise<FinanceKpis> {
  const statements = await prisma.commissionStatement.findMany({
    where: { partnerId, supersededBy: null },
    select: { status: true, totalCommissionAmount: true },
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
    supersededBy: null,
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
    select: {
      id: true,
      periodFrom: true,
      periodTo: true,
      status: true,
      totalCommissionAmount: true,
      pdfPath: true,
      xlsxPath: true,
      _count: { select: { items: true } },
    },
  });

  return rows.map(({ _count, totalCommissionAmount, ...s }) => ({
    ...s,
    totalCommissionAmount: totalCommissionAmount.toFixed(2),
    itemCount: _count.items,
  }));
}

export async function getStatementWithItems(
  prisma: PrismaClient,
  statementId: string,
  partnerId: string
) {
  return prisma.commissionStatement.findFirst({
    where: { id: statementId, partnerId },
    include: { items: { orderBy: { organizationName: 'asc' } } },
  });
}
