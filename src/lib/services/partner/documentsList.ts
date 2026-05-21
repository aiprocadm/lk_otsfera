import type { PrismaClient, DocumentType } from '@prisma/client';
import type { OrgDocumentRow } from './orgDocuments';

export type PartnerDocumentsFilter = {
  partnerId: string;
  scopeOrgIds?: string[];
  type?: DocumentType;
  search?: string;
  take: number;
  skip: number;
};

export type PartnerDocumentsResult = {
  rows: OrgDocumentRow[];
  total: number;
  countsByType: Partial<Record<DocumentType, number>>;
};

export async function listPartnerDocuments(
  prisma: PrismaClient,
  filter: PartnerDocumentsFilter
): Promise<PartnerDocumentsResult> {
  const orgs = await prisma.organization.findMany({
    where: {
      partnerId: filter.partnerId,
      ...(filter.scopeOrgIds && filter.scopeOrgIds.length > 0
        ? { id: { in: filter.scopeOrgIds } }
        : {})
    },
    select: { companyId: true }
  });

  const companyIds = orgs
    .map((o) => o.companyId)
    .filter((id): id is string => Boolean(id));

  if (companyIds.length === 0) {
    return { rows: [], total: 0, countsByType: {} };
  }

  const orderFilter = {
    partnerId: filter.partnerId,
    companyId: { in: companyIds }
  };

  const docWhere = {
    order: orderFilter,
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.search
      ? { name: { contains: filter.search, mode: 'insensitive' as const } }
      : {})
  };

  const [total, docs, countsRaw] = await Promise.all([
    prisma.document.count({ where: docWhere }),
    prisma.document.findMany({
      where: docWhere,
      orderBy: [{ createdAt: 'desc' }],
      take: filter.take,
      skip: filter.skip,
      select: {
        id: true,
        name: true,
        type: true,
        direction: true,
        signedAt: true,
        createdAt: true,
        size: true,
        orderId: true,
        order: { select: { orderNumber: true, title: true } }
      }
    }),
    prisma.document.groupBy({
      by: ['type'],
      where: { order: orderFilter, ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' as const } } : {}) },
      _count: { _all: true }
    })
  ]);

  const countsByType: Partial<Record<DocumentType, number>> = {};
  for (const c of countsRaw) {
    countsByType[c.type] = c._count._all;
  }

  const rows: OrgDocumentRow[] = docs.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    direction: d.direction,
    signedAt: d.signedAt,
    createdAt: d.createdAt,
    size: d.size,
    orderId: d.orderId,
    orderNumber: d.order.orderNumber,
    orderTitle: d.order.title
  }));

  return { rows, total, countsByType };
}
