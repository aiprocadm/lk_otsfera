import { notFound, redirect } from 'next/navigation';
import { getSession } from './session';
import type { SessionPayload } from './jwt';
import { prisma } from '@/lib/db/prisma';
import { canSeeOrder, isOrgInScope } from '@/lib/auth/managerPolicy';

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== 'admin') redirect('/forbidden');
  return session;
}

export async function requirePartnerAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  const isPartnerAdmin =
    session.role === 'partner' && session.partnerRole === 'admin';
  if (!isPartnerAdmin) redirect('/forbidden');
  return session;
}

export async function requireOrganization(): Promise<SessionPayload> {
  const session = await requireSession();
  const hasActiveMembership =
    session.role === 'organization' &&
    !!session.organizationMemberships?.some((m) => m.isActive);
  if (!hasActiveMembership) redirect('/forbidden');
  return session;
}

export async function requireOrganizationAdmin(orgId?: string): Promise<SessionPayload> {
  const session = await requireOrganization();
  const memberships = session.organizationMemberships ?? [];
  const isAdmin = orgId
    ? memberships.some((m) => m.isActive && m.roleInOrg === 'admin' && m.organizationId === orgId)
    : memberships.some((m) => m.isActive && m.roleInOrg === 'admin');
  if (!isAdmin) redirect('/forbidden');
  return session;
}

export async function requireOrganizationAdminOrLeader(orgId?: string): Promise<SessionPayload> {
  const session = await requireOrganization();
  const memberships = session.organizationMemberships ?? [];
  const ok = memberships.some(
    (m) =>
      m.isActive &&
      (m.roleInOrg === 'admin' || m.roleInOrg === 'leader') &&
      (!orgId || m.organizationId === orgId)
  );
  if (!ok) redirect('/forbidden');
  return session;
}

/**
 * Manager cabinet guards (Phase 8).
 *
 * `managedOrgIds` is populated by the session loader from the
 * `OrganizationManager` table. Its absence means the loader did not run for
 * this session — treat as unauthenticated and bounce to /login so the next
 * request re-loads. An *empty* array, however, is a valid manager session
 * (the user is a manager with no per-org assignments yet — they may still
 * see orders via direct `Order.managerId` ownership or historical comments).
 */
export async function requireManager(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== 'manager') redirect('/forbidden');
  if (session.managedOrgIds === undefined) redirect('/login');
  return session;
}

export async function requireManagerForOrg(orgId: string): Promise<SessionPayload> {
  const session = await requireManager();
  if (!isOrgInScope(session, orgId)) redirect('/manager/dashboard');
  return session;
}

export async function requireManagerForOrder(
  orderId: string
): Promise<{
  session: SessionPayload;
  order: { id: string; managerId: string | null; organizationId: string | null };
}> {
  const session = await requireManager();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, managerId: true, organizationId: true }
  });
  if (!order) notFound();

  // Three-way visibility check: managerId, org scope, or historical comments.
  // We only count comments when the cheaper checks (managerId / org scope)
  // miss, to avoid a needless query on the hot path.
  let commentsCountByMe = 0;
  if (order.managerId !== session.sub) {
    const inOrgScope =
      order.organizationId !== null && isOrgInScope(session, order.organizationId);
    if (!inOrgScope) {
      commentsCountByMe = await prisma.comment.count({
        where: { orderId: order.id, authorId: session.sub }
      });
    }
  }

  if (!canSeeOrder(session, { ...order, commentsCountByMe })) notFound();

  return { session, order };
}
