import { describe, it, expect, expectTypeOf } from 'vitest';
import { PrismaClient } from '@prisma/client';
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

  it('Payment is org-level: organizationId required, orderId optional', async () => {
    const prisma = new PrismaClient();
    const payment = (prisma as any)._runtimeDataModel.models.Payment;
    const fields = Object.fromEntries(payment.fields.map((f: any) => [f.name, f]));
    expect(fields.organizationId).toBeDefined();
    expect(fields.organizationId.isRequired).toBe(true);
    expect(fields.orderId.isRequired).toBe(false);
    await prisma.$disconnect();
  });
});
