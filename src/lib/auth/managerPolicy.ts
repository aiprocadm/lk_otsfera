import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Manager RBAC primitives — three-way visibility OR:
 *   1. Per-order: `Order.managerId == session.sub`
 *   2. Per-org:   `Order.organizationId` ∈ session.managedOrgIds
 *   3. Historical: this user ever commented on the order
 *
 * `managedOrgIds` is populated by the session loader (Task 4 of the
 * manager-cabinet plan) from the `OrganizationManager` table.
 */

export function managedOrgIds(session: SessionPayload): string[] {
  return session.managedOrgIds ?? [];
}

export function managerOrderScopeFilter(session: SessionPayload): Prisma.OrderWhereInput {
  return {
    OR: [
      { managerId: session.sub },
      { organizationId: { in: managedOrgIds(session) } },
      { comments: { some: { authorId: session.sub } } }
    ]
  };
}

export function managerDocumentScopeFilter(session: SessionPayload): Prisma.DocumentWhereInput {
  return {
    order: managerOrderScopeFilter(session),
    scanStatus: { not: 'infected' }
  };
}

export function managerOrgScopeFilter(session: SessionPayload): Prisma.OrganizationWhereInput {
  return { id: { in: managedOrgIds(session) } };
}

export function canSeeOrder(
  session: SessionPayload,
  order: {
    managerId: string | null;
    organizationId: string | null;
    companyId?: string | null;
    commentsCountByMe?: number;
  },
  teamMode = false
): boolean {
  if (teamMode) return !!session.companyId && order.companyId === session.companyId;
  if (order.managerId === session.sub) return true;
  if (order.organizationId && managedOrgIds(session).includes(order.organizationId)) return true;
  if ((order.commentsCountByMe ?? 0) > 0) return true;
  return false;
}

export function canSeeDocument(
  session: SessionPayload,
  doc: { order: { managerId: string | null; organizationId: string | null; companyId?: string | null } },
  teamMode = false
): boolean {
  return canSeeOrder(session, doc.order, teamMode);
}

export function canSeeOrganization(session: SessionPayload, orgId: string): boolean {
  return managedOrgIds(session).includes(orgId);
}

export const isOrgInScope = canSeeOrganization;

// ----- C8: company-wide mode -------------------------------------------------

const NO_COMPANY_SENTINEL = '__no_company__';

/** Company-wide order filter: every order in the manager's own company. */
export function companyWideOrderFilter(session: SessionPayload): Prisma.OrderWhereInput {
  // Order.companyId is required, so an impossible value denies all (fail-safe).
  return { companyId: session.companyId ?? NO_COMPANY_SENTINEL };
}

/** Resolver: pick the order filter by the live team-visibility flag. */
export function managerOrderScope(session: SessionPayload, teamMode: boolean): Prisma.OrderWhereInput {
  return teamMode ? companyWideOrderFilter(session) : managerOrderScopeFilter(session);
}

export function managerDocumentScope(session: SessionPayload, teamMode: boolean): Prisma.DocumentWhereInput {
  return { order: managerOrderScope(session, teamMode), scanStatus: { not: 'infected' } };
}

export function managerOrgScope(session: SessionPayload, teamMode: boolean): Prisma.OrganizationWhereInput {
  return teamMode ? { companyId: session.companyId ?? NO_COMPANY_SENTINEL } : managerOrgScopeFilter(session);
}

export function isManagerLeader(session: SessionPayload): boolean {
  return session.role === 'manager' && session.managerRole === 'leader';
}

/**
 * Лидер открывает любой заказ СВОЕЙ компании (инвариант C8: граница — компания).
 * companyId=null у лидера → false (деградирует в обычный scoped-путь, не deny-all).
 * Расширяет только деталь заказа, НЕ списки.
 */
export function isLeaderSameCompany(session: SessionPayload, orderCompanyId: string | null | undefined): boolean {
  return isManagerLeader(session) && !!session.companyId && orderCompanyId === session.companyId;
}

/**
 * The single DB read of the live toggle. Returns false when companyId is absent
 * — so a null-company manager can never reach the company-wide branch and simply
 * keeps the scoped model (NOT denied-all). The lookup is an indexed single-column read; callers MAY memoize per request,
 * but none currently do (the cost is negligible).
 */
export async function getCompanyTeamVisibility(
  prisma: PrismaClient,
  companyId: string | null | undefined
): Promise<boolean> {
  if (!companyId) return false;
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { managerTeamVisibility: true }
  });
  return company?.managerTeamVisibility ?? false;
}
