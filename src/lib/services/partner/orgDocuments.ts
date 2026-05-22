import type { PrismaClient, DocumentType, DocumentDirection } from '@prisma/client';
import { INFECTED_HIDDEN_WHERE } from '@/lib/services/scan/visibility';

export type OrgDocumentRow = {
  id: string;
  name: string;
  type: DocumentType;
  direction: DocumentDirection;
  signedAt: Date | null;
  createdAt: Date;
  size: number | null;
  orderId: string;
  orderNumber: string | null;
  orderTitle: string;
};

export type OrgDocumentsFilter = {
  orgId: string;
  partnerId: string;
  type?: DocumentType;
};

export type OrgDocumentsResult = {
  rows: OrgDocumentRow[];
  countsByType: Partial<Record<DocumentType, number>>;
  total: number;
};

export async function getOrgDocuments(
  prisma: PrismaClient,
  filter: OrgDocumentsFilter
): Promise<OrgDocumentsResult> {
  const org = await prisma.organization.findUnique({
    where: { id: filter.orgId },
    select: { companyId: true, partnerId: true }
  });

  if (!org || org.partnerId !== filter.partnerId || !org.companyId) {
    return { rows: [], countsByType: {}, total: 0 };
  }

  const orderFilter = { companyId: org.companyId, partnerId: filter.partnerId };

  const [docs, countsRaw] = await Promise.all([
    prisma.document.findMany({
      where: {
        order: orderFilter,
        ...INFECTED_HIDDEN_WHERE,
        ...(filter.type ? { type: filter.type } : {})
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
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
      where: { order: orderFilter, ...INFECTED_HIDDEN_WHERE },
      _count: { _all: true }
    })
  ]);

  const countsByType: Partial<Record<DocumentType, number>> = {};
  let total = 0;
  for (const c of countsRaw) {
    countsByType[c.type] = c._count._all;
    total += c._count._all;
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

  return { rows, countsByType, total };
}
