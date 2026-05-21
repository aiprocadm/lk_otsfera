import { describe, it, expectTypeOf } from 'vitest';
import type { CommissionStatement, CommissionStatementItem } from '@prisma/client';

describe('CommissionStatement and items', () => {
  it('statement has period, totals, status, pdf', () => {
    expectTypeOf<CommissionStatement>().toHaveProperty('partnerId');
    expectTypeOf<CommissionStatement>().toHaveProperty('periodFrom');
    expectTypeOf<CommissionStatement>().toHaveProperty('periodTo');
    expectTypeOf<CommissionStatement>().toHaveProperty('totalBaseAmount');
    expectTypeOf<CommissionStatement>().toHaveProperty('averageRate');
    expectTypeOf<CommissionStatement>().toHaveProperty('totalCommissionAmount');
    expectTypeOf<CommissionStatement>().toHaveProperty('status');
    expectTypeOf<CommissionStatement>().toHaveProperty('pdfPath');
    expectTypeOf<CommissionStatement>().toHaveProperty('supersededBy');
  });

  it('item ties statement to order with snapshot values', () => {
    expectTypeOf<CommissionStatementItem>().toHaveProperty('statementId');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('orderId');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('orderNumber');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('organizationName');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('baseAmount');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('rate');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('commissionAmount');
  });
});
