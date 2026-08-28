import type { PrismaClient, DocumentType } from '@prisma/client';
import {
  partnerChannelWhere,
  orderBoundWhere,
  orderLessWhere,
} from '@/lib/auth/documentChannelPolicy';
import type { OrgDocumentRow } from './orgDocuments';

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
export type PartnerDocumentsFilter = {
  partnerId: string;
  scopeOrgIds?: string[] | undefined;
  type?: DocumentType | undefined;
  search?: string | undefined;
  orderLess?: boolean | undefined;
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
  // Order-less docs are partner-level, not org-specific — the org-scope filter
  // targets the order.organizationId relation which is null for order-less docs,
  // so it would match nothing. Skip it entirely for the general tab.
  const orgScope =
    !filter.orderLess && filter.scopeOrgIds && filter.scopeOrgIds.length > 0
      ? { order: { organizationId: { in: filter.scopeOrgIds } } }
      : {};

  const orderAxisWhere = filter.orderLess ? orderLessWhere() : orderBoundWhere();

  const docWhere = {
    ...partnerChannelWhere(filter.partnerId),
    ...orderAxisWhere,
    ...orgScope,
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' as const } } : {}),
  };

  const groupByWhere = {
    ...partnerChannelWhere(filter.partnerId),
    ...orderAxisWhere,
    ...orgScope,
    ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' as const } } : {}),
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
        // `У-154`: номер и версия документа — их показывает список.
        number: true,
        version: true,
        order: { select: { orderNumber: true, title: true } },
      },
    }),
    prisma.document.groupBy({
      by: ['type'],
      where: groupByWhere,
      _count: { _all: true },
    }),
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
    orderTitle: d.order?.title ?? null,
    number: d.number,
    version: d.version,
  }));

  return { rows, total, countsByType };
}
