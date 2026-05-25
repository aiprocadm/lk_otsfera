import { redirect } from 'next/navigation';
import { getSession } from './session';
import type { SessionPayload } from './jwt';

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
