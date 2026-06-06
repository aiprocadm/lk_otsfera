import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * Admin-facing service powering the «Менеджеры организации» block on
 * `/admin/organizations/[id]`. Returns the full assignment history split into
 * active and inactive buckets so the UI can render both lists without a second
 * round-trip.
 *
 * Active rows are ordered by most recent assignment first; inactive rows by
 * most recent deactivation first so the most recently archived assignment is
 * easiest to find when reactivating.
 */

const ROW_INCLUDE = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true
    }
  }
} satisfies Prisma.OrganizationManagerInclude;

export type ManagerAssignmentRow = Prisma.OrganizationManagerGetPayload<{
  include: typeof ROW_INCLUDE;
}>;

export type ListManagersForOrgResult = {
  active: ManagerAssignmentRow[];
  inactive: ManagerAssignmentRow[];
};

export async function listManagersForOrg(
  prisma: PrismaClient,
  orgId: string
): Promise<ListManagersForOrgResult> {
  const rows = await prisma.organizationManager.findMany({
    where: { organizationId: orgId },
    include: ROW_INCLUDE,
    orderBy: [{ isActive: 'desc' }, { assignedAt: 'desc' }]
  });

  const active: ManagerAssignmentRow[] = [];
  const inactive: ManagerAssignmentRow[] = [];
  for (const row of rows) {
    if (row.isActive) {
      active.push(row);
    } else {
      inactive.push(row);
    }
  }
  // Inactive bucket: most recently deactivated first (assignedAt-desc from the
  // SQL ordering happens to align for the common case but is not authoritative
  // — sort explicitly by deactivatedAt to be deterministic when an admin
  // reactivates and then re-deactivates).
  inactive.sort((a, b) => {
    const aT = a.deactivatedAt?.getTime() ?? 0;
    const bT = b.deactivatedAt?.getTime() ?? 0;
    return bT - aT;
  });
  return { active, inactive };
}

export type CompanyManagerRow = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  managerRole: string | null;
  assignments: { id: string; organizationId: string; organizationName: string; isActive: boolean }[];
};

/**
 * All managers belonging to a company, with their org-assignment rows. Powers
 * the leader hub roster panel. Company membership = User.companyId.
 */
export async function listCompanyManagers(
  prisma: PrismaClient,
  companyId: string
): Promise<CompanyManagerRow[]> {
  const users = await prisma.user.findMany({
    where: { role: 'manager', companyId },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      managerRole: true,
      managedOrganizations: {
        where: { organization: { companyId } },
        select: {
          id: true,
          isActive: true,
          organization: { select: { id: true, name: true } }
        }
      }
    },
    orderBy: { name: 'asc' }
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    isActive: u.isActive,
    managerRole: u.managerRole,
    assignments: u.managedOrganizations.map((a) => ({
      id: a.id,
      organizationId: a.organization.id,
      organizationName: a.organization.name,
      isActive: a.isActive
    }))
  }));
}
