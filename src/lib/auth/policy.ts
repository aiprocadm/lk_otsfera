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
    const membership = await prisma.organizationUser.findFirst({ where: { userId: session.sub, organizationId, isActive: true }, select: { id: true } });
    return Boolean(membership);
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
    const membership = await prisma.organizationUser.findFirst({
      where: {
        userId: session.sub,
        isActive: true,
        organization: { companyId: order.companyId }
      },
      select: { id: true }
    });
    return Boolean(membership);
  }

  return false;
}

export async function canReadDocument(session: SessionPayload, document: DocumentLike) {
  const doc = document.order?.companyId
    ? document
    : await prisma.document.findUnique({ where: { id: document.id }, select: { id: true, order: { select: { companyId: true } } } });

  if (!doc?.order?.companyId) return false;

  return canReadOrder(session, { id: doc.id, companyId: doc.order.companyId });
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
