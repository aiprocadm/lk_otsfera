import { describe, it, expectTypeOf } from 'vitest';
import type { Partner } from '@prisma/client';

describe('Partner model fields', () => {
  it('has commissionRate, legalName, slug fields in type', () => {
    expectTypeOf<Partner>().toHaveProperty('commissionRate');
    expectTypeOf<Partner>().toHaveProperty('legalName');
    expectTypeOf<Partner>().toHaveProperty('slug');
  });
});
