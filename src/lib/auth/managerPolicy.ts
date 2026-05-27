import type { Prisma } from '@prisma/client';
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
  order: { managerId: string | null; organizationId: string | null; commentsCountByMe?: number }
): boolean {
  if (order.managerId === session.sub) return true;
  if (order.organizationId && managedOrgIds(session).includes(order.organizationId)) return true;
  if ((order.commentsCountByMe ?? 0) > 0) return true;
  return false;
}

export function canSeeDocument(
  session: SessionPayload,
  doc: { order: { managerId: string | null; organizationId: string | null } }
): boolean {
  return canSeeOrder(session, doc.order);
}

export function canSeeOrganization(session: SessionPayload, orgId: string): boolean {
  return managedOrgIds(session).includes(orgId);
}

export const isOrgInScope = canSeeOrganization;
