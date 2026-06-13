import { describe, expect, it } from 'vitest';
import { OneCOrgSchema, OneCOrderSchema, OneCPaymentSchema, OneCDocumentSchema } from '@/lib/services/oneCSync/schemas';

const validOrder = {
  externalId: '1c-order-1', title: 'T', organizationExternalId: '1c-org-1',
  totalAmount: 100, paidAmount: 50, vatIncluded: true,
  executionStatus: 'in_progress', financialStatus: 'partially_paid',
  productMix: ['training'], updatedAt: '2026-05-01T00:00:00Z'
};

describe('oneCSync zod schemas', () => {
  it('OneCOrderSchema accepts a valid order', () => {
    expect(OneCOrderSchema.safeParse(validOrder).success).toBe(true);
  });
  it('OneCOrderSchema rejects a bad enum', () => {
    const r = OneCOrderSchema.safeParse({ ...validOrder, executionStatus: 'nope' });
    expect(r.success).toBe(false);
  });
  it('OneCOrderSchema rejects a non-numeric amount', () => {
    expect(OneCOrderSchema.safeParse({ ...validOrder, totalAmount: '100' }).success).toBe(false);
  });
  it('OneCOrderSchema rejects garbage datetime but accepts ISO', () => {
    expect(OneCOrderSchema.safeParse({ ...validOrder, updatedAt: 'not-a-date' }).success).toBe(false);
  });
  it('OneCOrgSchema requires externalId and name', () => {
    expect(OneCOrgSchema.safeParse({ name: 'x', updatedAt: '2026-05-01T00:00:00Z' }).success).toBe(false);
  });
  it('OneCPaymentSchema and OneCDocumentSchema accept valid records', () => {
    expect(OneCPaymentSchema.safeParse({
      externalId: 'p1', orderExternalId: 'o1', amount: 5, paidAt: '2026-05-01T00:00:00Z',
      isRefund: false, updatedAt: '2026-05-01T00:00:00Z'
    }).success).toBe(true);
    expect(OneCDocumentSchema.safeParse({
      externalId: 'd1', orderExternalId: 'o1', type: 'act', name: 'a.pdf',
      mimeType: 'application/pdf', size: 1, downloadUrl: 'http://x/d1', updatedAt: '2026-05-01T00:00:00Z'
    }).success).toBe(true);
  });

  it('payment accepts order-level ref', () => {
    expect(OneCPaymentSchema.safeParse({ externalId:'P1', orderExternalId:'O1', amount:100, paidAt:'2026-04-01T00:00:00Z', isRefund:false, updatedAt:'2026-04-01T00:00:00Z' }).success).toBe(true);
  });
  it('payment accepts org-level ref (no order)', () => {
    expect(OneCPaymentSchema.safeParse({ externalId:'P2', organizationExternalId:'ORG1', amount:100, paidAt:'2026-04-01T00:00:00Z', isRefund:false, updatedAt:'2026-04-01T00:00:00Z' }).success).toBe(true);
  });
  it('payment rejects when neither order nor org ref present', () => {
    expect(OneCPaymentSchema.safeParse({ externalId:'P3', amount:100, paidAt:'2026-04-01T00:00:00Z', isRefund:false, updatedAt:'2026-04-01T00:00:00Z' }).success).toBe(false);
  });

  it('order accepts organizationInn instead of organizationExternalId', () => {
    expect(OneCOrderSchema.safeParse({ externalId:'O9', title:'t', organizationInn:'7700', totalAmount:1, paidAmount:0, vatIncluded:true, executionStatus:'pending', financialStatus:'billed', productMix:[], updatedAt:'2026-04-01T00:00:00Z' }).success).toBe(true);
  });
  it('order rejects when neither org key present', () => {
    expect(OneCOrderSchema.safeParse({ externalId:'O9', title:'t', totalAmount:1, paidAmount:0, vatIncluded:true, executionStatus:'pending', financialStatus:'billed', productMix:[], updatedAt:'2026-04-01T00:00:00Z' }).success).toBe(false);
  });
});
