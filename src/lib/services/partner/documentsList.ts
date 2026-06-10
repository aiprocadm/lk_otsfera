import type { PrismaClient, DocumentType } from '@prisma/client';
import { partnerChannelWhere, orderBoundWhere, orderLessWhere } from '@/lib/auth/documentChannelPolicy';
import type { OrgDocumentRow } from './orgDocuments';

export type PartnerDocumentsFilter = {
  partnerId: string;
  scopeOrgIds?: string[];
  type?: DocumentType;
  search?: string;
  orderLess?: boolean;
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
  const orgScope =
    filter.scopeOrgIds && filter.scopeOrgIds.length > 0
      ? { order: { organizationId: { in: filter.scopeOrgIds } } }
      : {};

  const orderAxisWhere = filter.orderLess ? orderLessWhere() : orderBoundWhere();

  const docWhere = {
    ...partnerChannelWhere(filter.partnerId),
    ...orderAxisWhere,
    ...orgScope,
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.search
      ? { name: { contains: filter.search, mode: 'insensitive' as const } }
      : {})
  };

  const groupByWhere = {
    ...partnerChannelWhere(filter.partnerId),
    ...orderAxisWhere,
    ...orgScope,
    ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' as const } } : {})
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
      where: groupByWhere,
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
    orderNumber: d.order?.orderNumber ?? null,
    orderTitle: d.order?.title ?? null
  }));

  return { rows, total, countsByType };
}
