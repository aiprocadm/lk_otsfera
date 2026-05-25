import type { PrismaClient, DocumentType, DocumentDirection } from '@prisma/client';
import { INFECTED_HIDDEN_WHERE } from '@/lib/services/scan/visibility';

export type OrgDocRow = {
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

export type ListOrgDocumentsOptions = {
  organizationId: string;
  type?: DocumentType;
  orderId?: string;
  from?: Date;
  to?: Date;
  search?: string;
  take?: number;
  skip?: number;
};

export type ListOrgDocumentsResult = {
  rows: OrgDocRow[];
  total: number;
  countsByType: Partial<Record<DocumentType, number>>;
};

const DEFAULT_TAKE = 50;
const MAX_TAKE = 200;

function normalizeTake(take: number | undefined): number {
  if (take === undefined) return DEFAULT_TAKE;
  if (!Number.isFinite(take) || take <= 0) return DEFAULT_TAKE;
  return Math.min(Math.floor(take), MAX_TAKE);
}

function normalizeSkip(skip: number | undefined): number {
  if (skip === undefined) return 0;
  if (!Number.isFinite(skip) || skip < 0) return 0;
  return Math.floor(skip);
}

export async function listOrgDocuments(
  prisma: PrismaClient,
  opts: ListOrgDocumentsOptions
): Promise<ListOrgDocumentsResult> {
  const take = normalizeTake(opts.take);
  const skip = normalizeSkip(opts.skip);

  const orderScope: { organizationId: string; id?: string } = {
    organizationId: opts.organizationId
  };
  if (opts.orderId) orderScope.id = opts.orderId;

  const dateFilter =
    opts.from || opts.to
      ? {
          createdAt: {
            ...(opts.from ? { gte: opts.from } : {}),
            ...(opts.to ? { lte: opts.to } : {})
          }
        }
      : {};

  const baseWhere = {
    order: orderScope,
    ...INFECTED_HIDDEN_WHERE,
    ...dateFilter,
    ...(opts.search
      ? { name: { contains: opts.search, mode: 'insensitive' as const } }
      : {})
  };

  const filteredWhere = {
    ...baseWhere,
    ...(opts.type ? { type: opts.type } : {})
  };

  const [total, docs, countsRaw] = await Promise.all([
    prisma.document.count({ where: filteredWhere }),
    prisma.document.findMany({
      where: filteredWhere,
      orderBy: [{ createdAt: 'desc' }],
      take,
      skip,
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
      where: baseWhere,
      _count: { _all: true }
    })
  ]);

  const countsByType: Partial<Record<DocumentType, number>> = {};
  for (const c of countsRaw) {
    countsByType[c.type] = c._count._all;
  }

  const rows: OrgDocRow[] = docs.map((d) => ({
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

export type DownloadResult =
  | { ok: true; path: string; mimeType: string; name: string }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'infected'; scanReason: string | null };

export async function getOrgDocumentForDownload(
  prisma: PrismaClient,
  organizationId: string,
  documentId: string
): Promise<DownloadResult> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      name: true,
      path: true,
      mimeType: true,
      scanStatus: true,
      scanReason: true,
      order: { select: { organizationId: true } }
    }
  });

  if (!doc) return { ok: false, error: 'not_found' };

  // Silent 404 for foreign org: do not reveal existence.
  if (doc.order.organizationId !== organizationId) {
    return { ok: false, error: 'not_found' };
  }

  if (doc.scanStatus === 'infected') {
    return { ok: false, error: 'infected', scanReason: doc.scanReason ?? null };
  }

  return {
    ok: true,
    path: doc.path,
    mimeType: doc.mimeType,
    name: doc.name
  };
}
