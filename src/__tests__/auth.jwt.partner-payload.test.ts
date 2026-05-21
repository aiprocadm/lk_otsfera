import { describe, it, expect, expectTypeOf } from 'vitest';
import type { SessionPayload, PartnerRoleInPartner } from '@/lib/auth/jwt';

describe('SessionPayload partner sub-role', () => {
  it('exposes optional partnerRole and assignedOrgIds', () => {
    expectTypeOf<SessionPayload>().toHaveProperty('partnerRole');
    expectTypeOf<SessionPayload>().toHaveProperty('assignedOrgIds');
  });

  it('PartnerRoleInPartner is union of admin | manager', () => {
    const admin: PartnerRoleInPartner = 'admin';
    const manager: PartnerRoleInPartner = 'manager';
    expect([admin, manager]).toEqual(['admin', 'manager']);
  });
});
