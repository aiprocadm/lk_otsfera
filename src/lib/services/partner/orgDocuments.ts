import type { PrismaClient, DocumentType, DocumentDirection } from '@prisma/client';
import { partnerChannelWhere } from '@/lib/auth/documentChannelPolicy';

export type OrgDocumentRow = {
  id: string;
  name: string;
  type: DocumentType;
  direction: DocumentDirection;
  signedAt: Date | null;
  createdAt: Date;
  size: number | null;
  orderId: string | null;
  orderNumber: string | null;
  orderTitle: string | null;
  /** Номер выпущенного документа; у загруженного вручную его нет. */
  number: string | null;
  /** Версия: 1 — первая, больше — переизданный документ (`У-151`). */
  version: number;
};

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
export type OrgDocumentsFilter = {
  orgId: string;
  partnerId: string;
  type?: DocumentType | undefined;
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
    select: { companyId: true, partnerId: true },
  });

  if (!org || org.partnerId !== filter.partnerId || !org.companyId) {
    return { rows: [], countsByType: {}, total: 0 };
  }

  const docWhere = {
    ...partnerChannelWhere(filter.partnerId),
    order: { organizationId: filter.orgId },
    ...(filter.type ? { type: filter.type } : {}),
  };

  const [docs, countsRaw] = await Promise.all([
    prisma.document.findMany({
      where: docWhere,
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
        // `У-154` (дефект `Д-16`): номер и версия — по ним человек отличает
        // «тот самый счёт» от его переизданной версии.
        number: true,
        version: true,
        order: { select: { orderNumber: true, title: true } },
      },
    }),
    prisma.document.groupBy({
      by: ['type'],
      where: {
        ...partnerChannelWhere(filter.partnerId),
        order: { organizationId: filter.orgId },
      },
      _count: { _all: true },
    }),
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
    orderNumber: d.order?.orderNumber ?? null,
    orderTitle: d.order?.title ?? null,
    number: d.number,
    version: d.version,
  }));

  return { rows, countsByType, total };
}
