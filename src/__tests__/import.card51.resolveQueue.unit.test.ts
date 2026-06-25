import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertPaymentRecord } = vi.hoisted(() => ({ upsertPaymentRecord: vi.fn() }));
vi.mock('@/lib/services/oneCSync/writers', () => ({ upsertPaymentRecord, orgInScope: () => true }));

import { resolveQueueRow, dismissQueueRow } from '@/lib/services/import/oneCAccountCard/resolve-queue';

const session = { sub: 'u1', role: 'admin', companyId: 'c1' } as never;

beforeEach(() => vi.clearAllMocks());

describe('resolveQueueRow', () => {
  it('promotes a queue row to Payment via writer, marks resolved', async () => {
    const row = { id: 'r1', externalId: '0000-9', amount: 100, paidAt: new Date('2026-06-01'), isRefund: false, purpose: 'x', paymentOrderNumber: '0000-9', vatAmount: null, status: 'needs_review' };
    const org = { id: 'org1', inn: '77', externalId: null };
    const prisma = {
      paymentImportRow: { findUnique: vi.fn().mockResolvedValue(row), update: vi.fn() },
      organization: { findUnique: vi.fn().mockResolvedValue(org) },
      order: { findUnique: vi.fn() },
      payment: { findUnique: vi.fn().mockResolvedValue({ id: 'pay1' }) },
    } as never;
    upsertPaymentRecord.mockImplementation(async (_db: unknown, _dto: unknown, sum: { created: number }) => { sum.created += 1; });

    const res = await resolveQueueRow(prisma, session, { rowId: 'r1', organizationId: 'org1', orderId: null });
    expect(res.ok).toBe(true);
    expect(upsertPaymentRecord).toHaveBeenCalledOnce();
  });

  it('returns not_found for missing row', async () => {
    const prisma = { paymentImportRow: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    expect(await resolveQueueRow(prisma, session, { rowId: 'x', organizationId: 'o', orderId: null })).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('dismissQueueRow', () => {
  it('marks row dismissed', async () => {
    const prisma = { paymentImportRow: { findUnique: vi.fn().mockResolvedValue({ id: 'r1' }), update: vi.fn() } } as never;
    const res = await dismissQueueRow(prisma, session, { rowId: 'r1' });
    expect(res.ok).toBe(true);
  });
});
