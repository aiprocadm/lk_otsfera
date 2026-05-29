import { prisma } from '@/lib/db/prisma';
import type { SessionPayload } from '@/lib/auth/jwt';

type AccessErrorCode = 'FORBIDDEN';

type OrderLike = { id: string; companyId: string };
type DocumentLike = { id: string; orderId: string; order?: { companyId: string } };

export function forbiddenResponse(message = 'Access denied', code: AccessErrorCode = 'FORBIDDEN') {
  return Response.json({ code, message }, { status: 403 });
}

export async function canAccessOrganization(session: SessionPayload, organizationId: string | null | undefined) {
  if (!organizationId) return false;
  if (session.role === 'admin') return true;

  if (session.role === 'partner') {
    if (!session.partnerId) return false;
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { partnerId: true } });
    return organization?.partnerId === session.partnerId;
  }

  if (session.role === 'organization') {
    return session.organizationId === organizationId;
  }

  if (session.role === 'manager') {
    // Manager visibility is driven by `OrganizationManager` (cached on session as
    // `managedOrgIds` at login by `auth/login.ts`). We delegate to `managerPolicy`
    // via a dynamic import to keep this module free of a static cycle with it.
    const { canSeeOrganization } = await import('@/lib/auth/managerPolicy');
    return canSeeOrganization(session, organizationId);
  }

  return false;
}

export async function canReadOrder(session: SessionPayload, order: OrderLike) {
  if (session.role === 'admin') return true;

  if (session.role === 'organization') {
    if (!session.organizationId) return false;
    const organizations = await prisma.organization.findMany({ where: { companyId: order.companyId }, select: { id: true } });
    return organizations.some((org: { id: string }) => org.id === session.organizationId);
  }

  if (session.role === 'partner') {
    if (!session.partnerId) return false;
    const organization = await prisma.organization.findFirst({
      where: { companyId: order.companyId, partnerId: session.partnerId },
      select: { id: true }
    });
    return Boolean(organization);
  }

  if (session.role === 'manager') {
    // Top-level RBAC guard: per-order ownership (Order.managerId === session.sub)
    // OR per-org scope (Order.organizationId ∈ session.managedOrgIds).
    //
    // Comments-history fallback path is intentionally NOT applied here — that's
    // the responsibility of downstream services (e.g. /manager/orders) that need
    // to surface historical visibility. This guard reflects the assignment graph
    // only.
    const { canSeeOrder } = await import('@/lib/auth/managerPolicy');
    const fullOrder = await prisma.order.findUnique({
      where: { id: order.id },
      select: { managerId: true, organizationId: true }
    });
    if (!fullOrder) return false;
    return canSeeOrder(session, fullOrder);
  }

  return false;
}

export async function canReadDocument(session: SessionPayload, document: DocumentLike) {
  const doc = document.order?.companyId
    ? document
    : await prisma.document.findUnique({ where: { id: document.id }, select: { id: true, orderId: true, order: { select: { companyId: true } } } });

  if (!doc?.order?.companyId) return false;

  // Pass the parent ORDER id, not the document id: canReadOrder() for the
  // manager role looks the Order up by this id, so passing doc.id silently
  // denied every manager. Both branches carry orderId now.
  return canReadOrder(session, { id: doc.orderId, companyId: doc.order.companyId });
}

export function isPartnerAdmin(session: SessionPayload): boolean {
  return session.role === 'partner' && session.partnerRole === 'admin';
}

export async function canPartnerAccessOrg(
  session: SessionPayload,
  organizationId: string
): Promise<boolean> {
  if (session.role !== 'partner' || !session.partnerId) return false;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { partnerId: true }
  });
  if (!org || org.partnerId !== session.partnerId) return false;

  const scope = session.assignedOrgIds ?? [];
  if (scope.length === 0) return true;
  return scope.includes(organizationId);
}

export function partnerOrgScopeFilter(
  session: SessionPayload
): { partnerId: string } | { partnerId: string; id: { in: string[] } } | { id: { in: never[] } } {
  if (!session.partnerId) return { id: { in: [] } };

  const scope = session.assignedOrgIds ?? [];
  if (scope.length === 0) return { partnerId: session.partnerId };
  return { partnerId: session.partnerId, id: { in: scope } };
}
