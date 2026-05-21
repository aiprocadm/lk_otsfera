import { describe, it, expectTypeOf } from 'vitest';
import type { Order } from '@prisma/client';

describe('Order model fields', () => {
  it('has financial and execution split, totals, lifecycle timestamps', () => {
    expectTypeOf<Order>().toHaveProperty('externalId');
    expectTypeOf<Order>().toHaveProperty('orderNumber');
    expectTypeOf<Order>().toHaveProperty('totalAmount');
    expectTypeOf<Order>().toHaveProperty('paidAmount');
    expectTypeOf<Order>().toHaveProperty('paidAt');
    expectTypeOf<Order>().toHaveProperty('contractSignedAt');
    expectTypeOf<Order>().toHaveProperty('completedAt');
    expectTypeOf<Order>().toHaveProperty('closedAt');
    expectTypeOf<Order>().toHaveProperty('lastSyncedAt');
    expectTypeOf<Order>().toHaveProperty('partnerId');
    expectTypeOf<Order>().toHaveProperty('vatIncluded');
    expectTypeOf<Order>().toHaveProperty('vatRate');
    expectTypeOf<Order>().toHaveProperty('executionStatus');
    expectTypeOf<Order>().toHaveProperty('financialStatus');
    expectTypeOf<Order>().toHaveProperty('productMix');
  });
});
