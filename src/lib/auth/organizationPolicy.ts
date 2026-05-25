import type { SessionPayload } from '@/lib/auth/jwt';

export function isOrgMember(session: SessionPayload, orgId: string): boolean {
  return !!session.organizationMemberships?.some(
    (m) => m.isActive && m.organizationId === orgId
  );
}

export function isOrgAdmin(session: SessionPayload, orgId: string): boolean {
  return !!session.organizationMemberships?.some(
    (m) => m.isActive && m.organizationId === orgId && m.roleInOrg === 'admin'
  );
}

export function activeOrgIds(session: SessionPayload): string[] {
  return (session.organizationMemberships ?? [])
    .filter((m) => m.isActive)
    .map((m) => m.organizationId);
}

export function organizationOrgScopeFilter(
  session: SessionPayload
): { id: { in: string[] } } {
  return { id: { in: activeOrgIds(session) } };
}

export function organizationOrderScopeFilter(
  session: SessionPayload
): { organizationId: { in: string[] } } {
  return { organizationId: { in: activeOrgIds(session) } };
}

export function canSeeOrder(
  session: SessionPayload,
  order: { organizationId: string | null }
): boolean {
  if (order.organizationId === null) return false;
  return isOrgMember(session, order.organizationId);
}

export function canSeeDocument(
  session: SessionPayload,
  doc: { order: { organizationId: string | null } }
): boolean {
  if (doc.order.organizationId === null) return false;
  return isOrgMember(session, doc.order.organizationId);
}
