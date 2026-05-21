import { describe, it, expectTypeOf } from 'vitest';
import type { Lead, LeadAttachment } from '@prisma/client';

describe('Lead and LeadAttachment models', () => {
  it('Lead has client info, status, promotion linkage', () => {
    expectTypeOf<Lead>().toHaveProperty('partnerId');
    expectTypeOf<Lead>().toHaveProperty('createdByUserId');
    expectTypeOf<Lead>().toHaveProperty('clientCompanyName');
    expectTypeOf<Lead>().toHaveProperty('clientContactName');
    expectTypeOf<Lead>().toHaveProperty('subject');
    expectTypeOf<Lead>().toHaveProperty('estimatedAmount');
    expectTypeOf<Lead>().toHaveProperty('productType');
    expectTypeOf<Lead>().toHaveProperty('status');
    expectTypeOf<Lead>().toHaveProperty('promotedOrderId');
  });

  it('LeadAttachment has reference to lead and file metadata', () => {
    expectTypeOf<LeadAttachment>().toHaveProperty('leadId');
    expectTypeOf<LeadAttachment>().toHaveProperty('name');
    expectTypeOf<LeadAttachment>().toHaveProperty('path');
  });
});
