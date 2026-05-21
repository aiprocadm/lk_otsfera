import { describe, it, expectTypeOf } from 'vitest';
import type { PartnerUser } from '@prisma/client';

describe('PartnerUser model', () => {
  it('exists with required fields', () => {
    expectTypeOf<PartnerUser>().toHaveProperty('partnerId');
    expectTypeOf<PartnerUser>().toHaveProperty('userId');
    expectTypeOf<PartnerUser>().toHaveProperty('roleInPartner');
    expectTypeOf<PartnerUser>().toHaveProperty('assignedOrgIds');
    expectTypeOf<PartnerUser>().toHaveProperty('isActive');
  });
});
