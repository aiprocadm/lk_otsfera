import type { SessionPayload } from '@/lib/auth/jwt';
import { managedOrgIds, isManagerLeader } from '@/lib/auth/managerPolicy';

export type ImportScope =
  | { unscoped: true; mayCreateOrgs: true }
  | { unscoped: false; mayCreateOrgs: false; allowedOrgIds: string[] };

/** admin & manager-leader = unscoped (all orgs, may create). Plain manager =
 *  scoped to assigned orgs (managedOrgIds), update-only. Write-scope uses
 *  assignment, NOT the C8 company-wide READ flag (see spec). */
export function importScope(session: SessionPayload): ImportScope {
  if (session.role === 'admin' || isManagerLeader(session)) {
    return { unscoped: true, mayCreateOrgs: true };
  }
  return { unscoped: false, mayCreateOrgs: false, allowedOrgIds: managedOrgIds(session) };
}
