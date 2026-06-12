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

export type DealsFilter = {
  partnerId: string;
  scopeOrgIds?: string[];
  search?: string;
  executionStatus?: ExecutionStatus;
  financialStatus?: FinancialStatus;
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
  const orgs = await prisma.organization.findMany({
    where: {
      partnerId: filter.partnerId,
      ...(filter.scopeOrgIds && filter.scopeOrgIds.length > 0
        ? { id: { in: filter.scopeOrgIds } }
        : {})
    },
    select: { id: true, name: true, companyId: true }
  });

  const companyIds = orgs.map((o) => o.companyId).filter((id): id is string => Boolean(id));
  if (companyIds.length === 0) return { rows: [], total: 0 };

  const orgByCompanyId = new Map<string, { id: string; name: string }>();
  for (const o of orgs) {
    if (o.companyId) orgByCompanyId.set(o.companyId, { id: o.id, name: o.name });
  }

  const where = {
    partnerId: filter.partnerId,
    companyId: { in: companyIds },
    ...(filter.executionStatus ? { executionStatus: filter.executionStatus } : {}),
    ...(filter.financialStatus ? { financialStatus: filter.financialStatus } : {}),
    ...(filter.search
      ? {
          OR: [
            { title: { contains: filter.search, mode: 'insensitive' as const } },
            { orderNumber: { contains: filter.search, mode: 'insensitive' as const } }
          ]
        }
      : {})
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
        companyId: true,
        createdAt: true,
        deadline: true,
        closedAt: true
      }
    })
  ]);

  const rows: DealRow[] = orders.map((o) => {
    const org = orgByCompanyId.get(o.companyId);
    const debt = (Number(o.totalAmount) - Number(o.paidAmount)).toFixed(2);

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
        paidTotal: Number(o.paidAmount)
      }),
      organizationName: org?.name ?? '—',
      organizationId: org?.id ?? null,
      createdAt: o.createdAt,
      deadline: o.deadline,
      closedAt: o.closedAt
    };
  });

  return { rows, total };
}
