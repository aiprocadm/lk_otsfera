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
