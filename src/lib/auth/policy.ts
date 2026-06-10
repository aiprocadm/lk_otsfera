import { prisma } from '@/lib/db/prisma';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadOrderLessDocument } from '@/lib/auth/documentChannelPolicy';

type AccessErrorCode = 'FORBIDDEN';

type OrderLike = { id: string; companyId: string };
type DocumentLike = {
  id: string;
  orderId: string | null;
  companyId?: string | null;
  order?: { companyId: string } | null;
  counterpartyType?: 'organization' | 'partner';
  counterpartyId?: string;
};

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
    const { canSeeOrganization, getCompanyTeamVisibility } = await import('@/lib/auth/managerPolicy');
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    if (teamMode) {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { companyId: true }
      });
      return !!session.companyId && org?.companyId === session.companyId;
    }
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
    const { canSeeOrder, getCompanyTeamVisibility } = await import('@/lib/auth/managerPolicy');
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    // `order` already carries companyId, so company-wide is a pure comparison.
    if (teamMode) return !!session.companyId && order.companyId === session.companyId;
    // Scoped mode: assignment graph only (no comments-history at this guard).
    const fullOrder = await prisma.order.findUnique({
      where: { id: order.id },
      select: { managerId: true, organizationId: true, companyId: true }
    });
    if (!fullOrder) return false;
    return canSeeOrder(session, fullOrder, false);
  }

  return false;
}

export async function canReadDocument(session: SessionPayload, document: DocumentLike) {
  // Re-fetch unless the caller already provided every field both branches need.
  const haveAll =
    document.counterpartyType && document.counterpartyId &&
    (document.order?.companyId || document.companyId || document.orderId === null);
  const doc = haveAll
    ? document
    : await prisma.document.findUnique({
        where: { id: document.id },
        select: {
          id: true, orderId: true, companyId: true,
          counterpartyType: true, counterpartyId: true,
          order: { select: { companyId: true } }
        }
      });
  if (!doc || !doc.counterpartyType || !doc.counterpartyId) return false;

  // Order-less branch: order is null, company anchor lives on the doc.
  if (doc.orderId === null) {
    return canReadOrderLessDocument(session, {
      counterpartyType: doc.counterpartyType,
      counterpartyId: doc.counterpartyId,
      companyId: doc.companyId ?? null
    });
  }

  // Order-bound branch (unchanged from Phase A).
  if (!doc.order?.companyId) return false;

  // Channel isolation for client roles (defense-in-depth at the download gate):
  // a partner reads only its partner-channel; an organization only org-channel.
  // Managers/admins see both channels within their order scope (unchanged).
  if (session.role === 'partner') {
    if (doc.counterpartyType !== 'partner' || doc.counterpartyId !== session.partnerId) return false;
  } else if (session.role === 'organization') {
    // Org-channel id is not re-checked here: canReadOrder() below ties the order to the
    // user's org/company. (Partner branch must pin counterpartyId because canReadOrder
    // is company-level for partners and does not isolate to a specific partner.)
    if (doc.counterpartyType !== 'organization') return false;
  }

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
