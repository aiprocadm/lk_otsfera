import { cookies } from 'next/headers';
import { requireOrganization } from '@/lib/auth/requireRole';
import { resolveActiveOrgId } from '@/lib/auth/orgContext';
import { activeOrgIds, isOrgAdmin, isOrgLeader } from '@/lib/auth/organizationPolicy';
import { prisma } from '@/lib/db/prisma';
import type { SessionPayload } from '@/lib/auth/jwt';
/** Membership для сайдбара организации. Тип живёт в lib — правило lib-no-upward (фаза 3). */
export type OrgSidebarMembership = {
  organizationId: string;
  organizationName: string;
  roleInOrg: 'admin' | 'leader' | 'member';
};

export type OrgPageContext = {
  session: SessionPayload;
  activeOrgId: string;
  activeOrgName: string;
  memberships: OrgSidebarMembership[];
  viewerRole: 'admin' | 'leader' | 'member';
};

/**
 * Resolve everything OrgAppShell needs in one helper call. Used in
 * every /organization/* page. Encapsulates session loading, query/cookie
 * org resolution, and organization name lookup.
 */
export async function getOrgPageContext(searchParams?: {
  org?: string | string[];
}): Promise<OrgPageContext> {
  const session = await requireOrganization();
  const cookieStore = await cookies();
  const cookieOrg = cookieStore.get('org_ctx')?.value ?? null;
  const queryOrg = typeof searchParams?.org === 'string' ? searchParams.org : undefined;

  const activeOrgId = resolveActiveOrgId(session, queryOrg, cookieOrg);
  const allowedIds = activeOrgIds(session);

  const orgs = await prisma.organization.findMany({
    where: { id: { in: allowedIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(orgs.map((o) => [o.id, o.name]));

  const memberships: OrgSidebarMembership[] = (session.organizationMemberships ?? [])
    .filter((m) => m.isActive)
    .map((m) => ({
      organizationId: m.organizationId,
      organizationName: nameById.get(m.organizationId) ?? '—',
      roleInOrg: m.roleInOrg,
    }));

  return {
    session,
    activeOrgId,
    activeOrgName: nameById.get(activeOrgId) ?? '—',
    memberships,
    viewerRole: isOrgAdmin(session, activeOrgId)
      ? 'admin'
      : isOrgLeader(session, activeOrgId)
        ? 'leader'
        : 'member',
  };
}
