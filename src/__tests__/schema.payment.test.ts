import { describe, it, expectTypeOf } from 'vitest';
import type { Payment } from '@prisma/client';

describe('Payment model', () => {
  it('has external linkage, amount, paid timestamp, refund flag', () => {
    expectTypeOf<Payment>().toHaveProperty('orderId');
    expectTypeOf<Payment>().toHaveProperty('externalId');
    expectTypeOf<Payment>().toHaveProperty('amount');
    expectTypeOf<Payment>().toHaveProperty('paidAt');
    expectTypeOf<Payment>().toHaveProperty('method');
    expectTypeOf<Payment>().toHaveProperty('isRefund');
  });
});
