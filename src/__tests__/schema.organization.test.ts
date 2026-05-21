import { describe, it, expectTypeOf } from 'vitest';
import type { Organization } from '@prisma/client';

describe('Organization model fields', () => {
  it('has 1С linkage and per-org commission override', () => {
    expectTypeOf<Organization>().toHaveProperty('externalId');
    expectTypeOf<Organization>().toHaveProperty('inn');
    expectTypeOf<Organization>().toHaveProperty('kpp');
    expectTypeOf<Organization>().toHaveProperty('assignedManagerUserId');
    expectTypeOf<Organization>().toHaveProperty('partnerCommissionRate');
    expectTypeOf<Organization>().toHaveProperty('partnerCommissionRateNote');
    expectTypeOf<Organization>().toHaveProperty('partnerCommissionRateChangedAt');
    expectTypeOf<Organization>().toHaveProperty('partnerCommissionRateChangedBy');
  });
});
