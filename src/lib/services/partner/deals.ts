import type { PrismaClient, ExecutionStatus, FinancialStatus } from '@prisma/client';
import { orderStage, type Stage } from '@/lib/orders/humanStage';

export type DealRow = {
  id: string;
  orderNumber: string | null;
  title: string;
  totalAmount: string;
  paidAmount: string;
  debt: string;
  executionStatus: ExecutionStatus;
  financialStatus: FinancialStatus;
  stage: Stage;
  organizationName: string;
  organizationId: string | null;
  createdAt: Date;
  deadline: Date | null;
  closedAt: Date | null;
};

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
export type DealsFilter = {
  partnerId: string;
  scopeOrgIds?: string[] | undefined;
  search?: string | undefined;
  executionStatus?: ExecutionStatus | undefined;
  financialStatus?: FinancialStatus | undefined;
  take: number;
  skip: number;
};

export type DealsResult = {
  rows: DealRow[];
  total: number;
};

export async function listPartnerDeals(
  prisma: PrismaClient,
  filter: DealsFilter
): Promise<DealsResult> {
  // F2: the partner sees an order ONLY through its own lead (Order.promotedFromLead
  // → Lead.partnerId), not via the legacy direct Order.partnerId. F8: organization
  // name is read from the order's own organization relation (exact per-order),
  // never a companyId→org map that collides when 2 orgs share a company.
  const where = {
    promotedFromLead: { partnerId: filter.partnerId },
    ...(filter.scopeOrgIds && filter.scopeOrgIds.length > 0
      ? { organizationId: { in: filter.scopeOrgIds } }
      : {}),
    ...(filter.executionStatus ? { executionStatus: filter.executionStatus } : {}),
    ...(filter.financialStatus ? { financialStatus: filter.financialStatus } : {}),
    ...(filter.search
      ? {
          OR: [
            { title: { contains: filter.search, mode: 'insensitive' as const } },
            { orderNumber: { contains: filter.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: filter.take,
      skip: filter.skip,
      select: {
        id: true,
        orderNumber: true,
        title: true,
        totalAmount: true,
        paidAmount: true,
        executionStatus: true,
        financialStatus: true,
        createdAt: true,
        deadline: true,
        closedAt: true,
        organization: { select: { id: true, name: true } },
      },
    }),
  ]);

  const rows: DealRow[] = orders.map((o) => {
    const debt = o.totalAmount.minus(o.paidAmount).toFixed(2);

    return {
      id: o.id,
      orderNumber: o.orderNumber,
      title: o.title,
      totalAmount: o.totalAmount.toFixed(2),
      paidAmount: o.paidAmount.toFixed(2),
      debt,
      executionStatus: o.executionStatus,
      financialStatus: o.financialStatus,
      stage: orderStage({
        executionStatus: o.executionStatus,
        financialStatus: o.financialStatus,
        amount: Number(o.totalAmount),
        paidTotal: Number(o.paidAmount),
      }),
      organizationName: o.organization?.name ?? '—',
      organizationId: o.organization?.id ?? null,
      createdAt: o.createdAt,
      deadline: o.deadline,
      closedAt: o.closedAt,
    };
  });

  return { rows, total };
}
