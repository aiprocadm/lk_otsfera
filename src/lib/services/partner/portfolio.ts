import type { PrismaClient } from '@prisma/client';

export type PortfolioFilters = {
  partnerId: string;
  scopeOrgIds?: string[];
  search?: string;
  take: number;
  skip: number;
};

export type PortfolioItem = {
  id: string;
  name: string;
  inn: string | null;
  assignedManagerUserId: string | null;
  ordersCount: number;
  debt: string; // Decimal as string for safe serialisation
};

export type PortfolioResult = {
  items: PortfolioItem[];
  total: number;
};

export async function listPortfolio(
  prisma: PrismaClient,
  filters: PortfolioFilters
): Promise<PortfolioResult> {
  const where = {
    partnerId: filters.partnerId,
    ...(filters.scopeOrgIds && filters.scopeOrgIds.length > 0
      ? { id: { in: filters.scopeOrgIds } }
      : {}),
    ...(filters.search
      ? { name: { contains: filters.search, mode: 'insensitive' as const } }
      : {})
  };

  const [total, rows] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: { name: 'asc' },
      take: filters.take,
      skip: filters.skip,
      select: {
        id: true,
        name: true,
        inn: true,
        assignedManagerUserId: true
      }
    })
  ]);

  const items: PortfolioItem[] = await Promise.all(
    rows.map(async (org) => {
      // F2: count only orders visible via the partner's leads; scope by the exact
      // organizationId (not companyId, which would also be the F8 collision).
      const orders = await prisma.order.findMany({
        where: { organizationId: org.id, promotedFromLead: { partnerId: filters.partnerId } },
        select: { totalAmount: true, paidAmount: true, executionStatus: true }
      });

      const ordersCount = orders.length;
      const debt = orders
        .filter((o) => o.executionStatus !== 'cancelled')
        .reduce((sum, o) => sum + Number(o.totalAmount) - Number(o.paidAmount), 0);

      return baseItem(org, ordersCount, debt.toFixed(2));
    })
  );

  return { items, total };
}

function baseItem(
  org: { id: string; name: string; inn: string | null; assignedManagerUserId: string | null },
  ordersCount: number,
  debt: string
): PortfolioItem {
  return {
    id: org.id,
    name: org.name,
    inn: org.inn,
    assignedManagerUserId: org.assignedManagerUserId,
    ordersCount,
    debt
  };
}
