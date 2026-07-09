import type { SessionPayload } from '@/lib/auth/jwt';
import { managedOrgIds, isManagerLeader } from '@/lib/auth/managerPolicy';

export type ImportScope =
  | { kind: 'global' } // admin — Model A: cross-company, unrestricted.
  | { kind: 'company'; companyId: string } // manager-leader — own company only (C8).
  | { kind: 'orgs'; allowedOrgIds: string[] }; // plain manager — assigned orgs only.

/**
 * Write/read scope for the 1C import surface.
 *  - admin           → global (Model A).
 *  - manager-leader  → their OWN company (invariant C8: the tenant boundary is the
 *    company, exactly like managerPolicy.companyWideOrderFilter / isLeaderSameCompany /
 *    managerOrgScope). A leader is NOT cross-company unscoped — that is admin-only.
 *  - plain manager   → assigned orgs (managedOrgIds).
 * Fail-safe: a leader with no companyId degrades to the assigned-orgs path (never
 * global), mirroring isLeaderSameCompany's null-company degrade.
 */
export function importScope(session: SessionPayload): ImportScope {
  if (session.role === 'admin') return { kind: 'global' };
  if (isManagerLeader(session) && session.companyId) {
    return { kind: 'company', companyId: session.companyId };
  }
  return { kind: 'orgs', allowedOrgIds: managedOrgIds(session) };
}
