import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrgScopeFilter, canSeeOrganization } from '@/lib/auth/managerPolicy';

/**
 * Manager-facing organizations service.
 *
 * Visibility is governed strictly by the per-org assignment branch of the
 * manager RBAC scope (`managerOrgScopeFilter` = `id ∈ session.managedOrgIds`).
 * Unlike `services/manager/orders`, the historical-comments branch does NOT
 * grant org-level visibility: a manager who once commented on an org's order
 * can still see *that order* (and may follow links from there), but the
 * organization itself only appears in this list when the admin assigns them
 * via `OrganizationManager`.
 *
 * `getOrganization` performs a defensive in-process scope check on top of the
 * by-id `findUnique` so a foreign org id returns `null` (no existence-leak)
 * even though the prisma fetch crosses scope.
 */

const LIST_SELECT = {
  id: true,
  name: true,
  _count: {
    select: {
      orders: true,
      students: true
    }
  }
} satisfies Prisma.OrganizationSelect;

export type ManagerOrgListRow = Prisma.OrganizationGetPayload<{ select: typeof LIST_SELECT }>;

export async function listOrganizations(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<ManagerOrgListRow[]> {
  return prisma.organization.findMany({
    where: managerOrgScopeFilter(session),
    select: LIST_SELECT,
    orderBy: { name: 'asc' }
  });
}

const DETAIL_INCLUDE = {
  _count: {
    select: {
      orders: true,
      students: true,
      users: true
    }
  },
  partner: { select: { id: true, name: true } }
} satisfies Prisma.OrganizationInclude;

export type ManagerOrgDetail = Prisma.OrganizationGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export async function getOrganization(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<ManagerOrgDetail | null> {
  if (!canSeeOrganization(session, orgId)) return null;
  return prisma.organization.findUnique({
    where: { id: orgId },
    include: DETAIL_INCLUDE
  });
}
