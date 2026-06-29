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

  it('keeps row queued (write_skipped) when writer skips and no Payment is created', async () => {
    const row = { id: 'r1', externalId: '0000-9', amount: 100, paidAt: new Date('2026-06-01'), isRefund: false, purpose: 'x', paymentOrderNumber: '0000-9', vatAmount: null, status: 'needs_review' };
    const org = { id: 'org1', inn: '77', externalId: null };
    const prisma = {
      paymentImportRow: { findUnique: vi.fn().mockResolvedValue(row), update: vi.fn() },
      organization: { findUnique: vi.fn().mockResolvedValue(org) },
      order: { findUnique: vi.fn() },
      payment: { findUnique: vi.fn().mockResolvedValue(null) },
    } as never;
    upsertPaymentRecord.mockImplementation(async () => { /* writer skips: no Payment created */ });

    const res = await resolveQueueRow(prisma, session, { rowId: 'r1', organizationId: 'org1', orderId: null });
    expect(res).toEqual({ ok: false, error: 'write_skipped' });
    expect((prisma as { paymentImportRow: { update: ReturnType<typeof vi.fn> } }).paymentImportRow.update).not.toHaveBeenCalled();
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

// C8 cross-company isolation: a manager may only act on queue rows whose batch
// belongs to their own company. The companion read (listQueue) already scopes by
// batch.companyId; the mutating helpers must enforce the same boundary or a manager
// in company B could flip the status of company A's payment-import rows (IDOR).
describe('queue mutation is company-scoped for non-admin staff', () => {
  const managerA = { sub: 'm', role: 'manager', companyId: 'companyA' } as never;
  const managerB = { sub: 'm', role: 'manager', companyId: 'companyB' } as never;
  const foreignRow = {
    id: 'r1', externalId: '0000-9', amount: 100, paidAt: new Date('2026-06-01'),
    isRefund: false, purpose: 'x', paymentOrderNumber: '0000-9', vatAmount: null,
    status: 'needs_review', batch: { companyId: 'companyA' },
  };

  it('dismissQueueRow denies a row from another company (not_found, no write)', async () => {
    const update = vi.fn();
    const prisma = { paymentImportRow: { findUnique: vi.fn().mockResolvedValue(foreignRow), update } } as never;
    const res = await dismissQueueRow(prisma, managerB, { rowId: 'r1' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(update).not.toHaveBeenCalled();
  });

  it('dismissQueueRow allows a row from the manager’s own company', async () => {
    const update = vi.fn();
    const prisma = { paymentImportRow: { findUnique: vi.fn().mockResolvedValue(foreignRow), update } } as never;
    const res = await dismissQueueRow(prisma, managerA, { rowId: 'r1' });
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'dismissed' } });
  });

  // Fail-safe (CLAUDE.md §4): a manager with no companyId must be denied, never matched
  // against a null-company batch via null === null. Mirrors listQueue's '__none__' sentinel.
  it('dismissQueueRow denies a null-company manager even on a null-company batch', async () => {
    const nullCompanyManager = { sub: 'm', role: 'manager', companyId: null } as never;
    const update = vi.fn();
    const nullBatchRow = { id: 'r1', batch: { companyId: null } };
    const prisma = { paymentImportRow: { findUnique: vi.fn().mockResolvedValue(nullBatchRow), update } } as never;
    const res = await dismissQueueRow(prisma, nullCompanyManager, { rowId: 'r1' });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(update).not.toHaveBeenCalled();
  });

  it('resolveQueueRow denies a row from another company (not_found, no write)', async () => {
    // org is fully resolvable so the ONLY thing that may stop the write is the
    // company guard on the row lookup — proves the guard, not an incidental miss.
    const update = vi.fn();
    const prisma = {
      paymentImportRow: { findUnique: vi.fn().mockResolvedValue(foreignRow), update },
      organization: { findUnique: vi.fn().mockResolvedValue({ id: 'org1', inn: '77', externalId: null }) },
      order: { findUnique: vi.fn() },
      payment: { findUnique: vi.fn() },
    } as never;
    const res = await resolveQueueRow(prisma, managerB, { rowId: 'r1', organizationId: 'org1', orderId: null });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(update).not.toHaveBeenCalled();
    expect(upsertPaymentRecord).not.toHaveBeenCalled();
  });
});
