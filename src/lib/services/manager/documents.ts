import { z } from 'zod';
import type { PrismaClient, Prisma, DocumentType } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerDocumentScope, canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';

/**
 * Manager-facing documents service.
 *
 * Visibility delegates to `managerDocumentScopeFilter`, which is the three-way
 * RBAC scope from `managerOrderScopeFilter` (per-order managerId, per-org
 * assignment, historical comments) plus `scanStatus != 'infected'` so that
 * managers never see ClamAV-flagged files. Platform admins use a different
 * code path; this service is only invoked from the manager cabinet.
 *
 * The download helper performs an additional in-process RBAC check after
 * fetching the document by id so a foreign-org document returns `not_found`
 * silently (no existence-leak) even though the prisma fetch crosses scope.
 */

const ListDocumentsOptionsSchema = z.object({
  session: z.custom<SessionPayload>((v) => !!v && typeof v === 'object' && 'sub' in (v as object)),
  q: z.string().optional(),
  orderId: z.string().optional(),
  type: z.string().optional(),
  take: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional()
});

export type ListDocumentsOptions = z.input<typeof ListDocumentsOptionsSchema>;

const LIST_INCLUDE = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      title: true,
      managerId: true,
      organizationId: true
    }
  }
} satisfies Prisma.DocumentInclude;

export type ManagerDocumentRow = Prisma.DocumentGetPayload<{ include: typeof LIST_INCLUDE }>;

export type ListDocumentsResult = {
  rows: ManagerDocumentRow[];
  nextCursor: string | null;
};

export async function listDocuments(
  prisma: PrismaClient,
  optsRaw: ListDocumentsOptions
): Promise<ListDocumentsResult> {
  const opts = ListDocumentsOptionsSchema.parse(optsRaw);
  const teamMode = await getCompanyTeamVisibility(prisma, opts.session.companyId);
  const scope = managerDocumentScope(opts.session, teamMode);
  const filters: Prisma.DocumentWhereInput[] = [scope];
  if (opts.orderId) filters.push({ orderId: opts.orderId });
  if (opts.type) filters.push({ type: opts.type as DocumentType });
  if (opts.q) {
    filters.push({ name: { contains: opts.q, mode: 'insensitive' } });
  }

  const rows = await prisma.document.findMany({
    where: { AND: filters },
    include: LIST_INCLUDE,
    orderBy: { id: 'desc' },
    take: opts.take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {})
  });

  const hasMore = rows.length > opts.take;
  const sliced = hasMore ? rows.slice(0, opts.take) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1]!.id : null;
  return { rows: sliced, nextCursor };
}

export type DownloadResult =
  | { ok: true; path: string; mimeType: string; name: string }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'infected'; scanReason: string | null };

export async function getDocumentForDownload(
  prisma: PrismaClient,
  session: SessionPayload,
  documentId: string
): Promise<DownloadResult> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      name: true,
      path: true,
      mimeType: true,
      scanStatus: true,
      scanReason: true,
      order: {
        select: {
          managerId: true,
          organizationId: true,
          companyId: true
        }
      }
    }
  });

  if (!doc) return { ok: false, error: 'not_found' };

  // Silent 404 for out-of-scope documents: do not leak existence. In company-wide
  // mode the cheap companyId check decides, so we skip the historical-comment
  // count entirely; in scoped mode we count comments only when managerId/org miss.
  let commentsCountByMe = 0;
  if (
    !teamMode &&
    doc.order.managerId !== session.sub &&
    !(doc.order.organizationId && (session.managedOrgIds ?? []).includes(doc.order.organizationId))
  ) {
    commentsCountByMe = await prisma.comment.count({
      where: { order: { documents: { some: { id: documentId } } }, authorId: session.sub }
    });
  }

  if (!canSeeOrder(session, { ...doc.order, commentsCountByMe }, teamMode)) {
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
