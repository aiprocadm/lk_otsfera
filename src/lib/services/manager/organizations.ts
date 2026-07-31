import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  managerOrgScope,
  canSeeOrganization,
  getCompanyTeamVisibility,
  isLeaderSameCompany,
} from '@/lib/auth/managerPolicy';

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
      students: true,
    },
  },
} satisfies Prisma.OrganizationSelect;

export type ManagerOrgListRow = Prisma.OrganizationGetPayload<{ select: typeof LIST_SELECT }>;

export async function listOrganizations(
  prisma: PrismaClient,
  session: SessionPayload,
  teamModeOverride?: boolean
): Promise<ManagerOrgListRow[]> {
  const teamMode = teamModeOverride ?? (await getCompanyTeamVisibility(prisma, session.companyId));
  return prisma.organization.findMany({
    where: managerOrgScope(session, teamMode),
    select: LIST_SELECT,
    orderBy: { name: 'asc' },
  });
}

const DETAIL_INCLUDE = {
  _count: {
    select: {
      orders: true,
      students: true,
      users: true,
    },
  },
  partner: { select: { id: true, name: true } },
} satisfies Prisma.OrganizationInclude;

export type ManagerOrgDetail = Prisma.OrganizationGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export async function getOrganization(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<ManagerOrgDetail | null> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  // Fetch by id, then check scope in-process so a foreign org returns null
  // (no existence-leak) — company-wide needs org.companyId.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: DETAIL_INCLUDE,
  });
  if (!org) return null;
  if (teamMode) {
    return !!session.companyId && org.companyId === session.companyId ? org : null;
  }
  // Лидер-инвариант C8 — тот же, что в карточке организации (см. комментарий там).
  return canSeeOrganization(session, orgId) || isLeaderSameCompany(session, org.companyId)
    ? org
    : null;
}
