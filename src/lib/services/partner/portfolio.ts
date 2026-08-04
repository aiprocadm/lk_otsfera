import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
export type PortfolioFilters = {
  partnerId: string;
  scopeOrgIds?: string[] | undefined;
  search?: string | undefined;
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
    ...(filters.search ? { name: { contains: filters.search, mode: 'insensitive' as const } } : {}),
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
        assignedManagerUserId: true,
      },
    }),
  ]);

  // F2: count only orders visible via the partner's leads; scope by the exact
  // organizationId (not companyId, which would also be the F8 collision).
  // Batched: one query for the whole page of orgs instead of one per org.
  const orgIds = rows.map((org) => org.id);
  const orders = orgIds.length
    ? await prisma.order.findMany({
        where: {
          organizationId: { in: orgIds },
          promotedFromLead: { partnerId: filters.partnerId },
        },
        select: {
          organizationId: true,
          totalAmount: true,
          paidAmount: true,
          executionStatus: true,
        },
      })
    : [];

  const aggByOrg = new Map<string, { ordersCount: number; debt: Prisma.Decimal }>();
  for (const o of orders) {
    const agg = aggByOrg.get(o.organizationId) ?? { ordersCount: 0, debt: new Prisma.Decimal(0) };
    agg.ordersCount += 1;
    if (o.executionStatus !== 'cancelled') {
      agg.debt = agg.debt.plus(o.totalAmount).minus(o.paidAmount);
    }
    aggByOrg.set(o.organizationId, agg);
  }

  const items: PortfolioItem[] = rows.map((org) => {
    const agg = aggByOrg.get(org.id);
    return baseItem(org, agg?.ordersCount ?? 0, (agg?.debt ?? new Prisma.Decimal(0)).toFixed(2));
  });

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
    debt,
  };
}
