import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { importScope } from '@/lib/services/oneCSync/scope';

/**
 * Read-side helpers backing the queue "Привязать" dialog: search organizations
 * and list their orders for the operator to bind a `needs_review` row to.
 *
 * Visibility mirrors `importScope` (the same scope the writer enforces): admin
 * and manager-leader are unscoped; a plain manager only sees orgs in
 * `managedOrgIds`. This is defense-in-depth + UX — the hard write boundary
 * still lives in `resolveQueueRow` (out-of-scope binds return `write_skipped`).
 */

const MAX_TAKE = 50;

export type ResolveOrgOption = { id: string; name: string; inn: string | null };
export type ResolveOrderOption = { id: string; orderNumber: string | null; title: string };

function isStaff(s: SessionPayload) {
  return s.role === 'admin' || s.role === 'manager';
}

export async function searchResolveOrgs(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { q?: string; take?: number }
): Promise<ResolveOrgOption[]> {
  if (!isStaff(session)) return [];
  const scope = importScope(session);
  const take = Math.min(Math.max(args.take ?? MAX_TAKE, 1), MAX_TAKE);
  const q = args.q?.trim();

  const and: Prisma.OrganizationWhereInput[] = [];
  if (!scope.unscoped) {
    if (scope.allowedOrgIds.length === 0) return [];
    and.push({ id: { in: scope.allowedOrgIds } });
  }
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { inn: { contains: q, mode: 'insensitive' } },
        { externalId: { contains: q, mode: 'insensitive' } }
      ]
    });
  }

  return prisma.organization.findMany({
    where: and.length ? { AND: and } : {},
    select: { id: true, name: true, inn: true },
    orderBy: { name: 'asc' },
    take
  });
}

export async function listResolveOrders(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { organizationId: string }
): Promise<ResolveOrderOption[]> {
  if (!isStaff(session)) return [];
  const scope = importScope(session);
  if (!scope.unscoped && !scope.allowedOrgIds.includes(args.organizationId)) return [];
  return prisma.order.findMany({
    where: { organizationId: args.organizationId },
    select: { id: true, orderNumber: true, title: true },
    orderBy: { id: 'desc' },
    take: MAX_TAKE
  });
}
