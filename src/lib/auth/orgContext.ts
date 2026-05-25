import type { SessionPayload } from '@/lib/auth/jwt';
import { activeOrgIds } from '@/lib/auth/organizationPolicy';

/**
 * Pick the active organization context for a session, preferring an
 * explicit query-param, falling back to a cookie value, then to the
 * first active membership.
 *
 * Invariant (enforced by caller via requireOrganization): session must
 * have at least one active organizationMembership. This function throws
 * if the invariant is violated, which would be a programming error.
 */
export function resolveActiveOrgId(
  session: SessionPayload,
  queryOrgId: string | null | undefined,
  cookieOrgId: string | null | undefined
): string {
  const allowed = activeOrgIds(session);
  if (allowed.length === 0) {
    throw new Error('resolveActiveOrgId: session has no active organization memberships');
  }

  if (queryOrgId && allowed.includes(queryOrgId)) return queryOrgId;
  if (cookieOrgId && allowed.includes(cookieOrgId)) return cookieOrgId;
  return allowed[0]!;
}
