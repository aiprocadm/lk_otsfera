import { describe, it, expectTypeOf } from 'vitest';
import type { OneCAdapter } from '@/lib/services/oneCSync/adapter';

describe('OneCAdapter interface', () => {
  it('exposes the four pull methods and one push', () => {
    expectTypeOf<OneCAdapter['pullOrders']>().toBeFunction();
    expectTypeOf<OneCAdapter['pullPayments']>().toBeFunction();
    expectTypeOf<OneCAdapter['pullDocuments']>().toBeFunction();
    expectTypeOf<OneCAdapter['pullOrganizations']>().toBeFunction();
    expectTypeOf<OneCAdapter['pushLead']>().toBeFunction();
  });
});
