import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isTransientSkip,
  capturePendingSkips,
  replayPendingRecords,
  type CursorEntity,
} from '@/lib/services/oneCSync/pending';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';

// Mock the writers the replay dispatches to.
const { upsertPaymentRecord } = vi.hoisted(() => ({ upsertPaymentRecord: vi.fn() }));
vi.mock('@/lib/services/oneCSync/writers', () => ({
  upsertOrgRecord: vi.fn(),
  upsertOrderRecord: vi.fn(),
  upsertPaymentRecord,
  upsertDocumentRecord: vi.fn(),
}));

describe('isTransientSkip', () => {
  it('treats dependency-ordering skips as transient', () => {
    expect(isTransientSkip('organization_not_found')).toBe(true);
    expect(isTransientSkip('order_not_found')).toBe(true);
    expect(isTransientSkip('document_fetch_failed')).toBe(true);
  });
  it('treats partner/scope skips as permanent', () => {
    expect(isTransientSkip('partner_not_found')).toBe(false);
    expect(isTransientSkip('no_partner_external_id')).toBe(false);
    expect(isTransientSkip('out_of_scope')).toBe(false);
  });
  it('treats unknown reasons as permanent (fail closed — do not retry forever)', () => {
    expect(isTransientSkip('something_new')).toBe(false);
  });
});

describe('capturePendingSkips', () => {
  const rawByExt = (ext: string) => ({ externalId: ext, updatedAt: '2026-06-01T00:00:00Z' });

  it('upserts a pending row for each transient skip, matched to its raw DTO', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { upsert } } as never;
    const raw = [rawByExt('P1'), rawByExt('P2'), rawByExt('P3')];
    const summary = emptySummary();
    summary.skips = [
      { externalId: 'P1', reason: 'organization_not_found' }, // transient → captured
      { externalId: 'P3', reason: 'out_of_scope' }, // permanent → ignored
    ];

    await capturePendingSkips(
      db,
      'payment' as CursorEntity,
      raw,
      (r) => (r as { externalId: string }).externalId,
      summary
    );

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      where: { entity_externalId: { entity: 'payment', externalId: 'P1' } },
      create: {
        entity: 'payment',
        externalId: 'P1',
        dto: raw[0],
        reason: 'organization_not_found',
      },
      update: { reason: 'organization_not_found', status: 'pending' },
    });
  });

  it('does nothing when there are no transient skips', async () => {
    const upsert = vi.fn();
    const db = { oneCPendingRecord: { upsert } } as never;
    const summary = emptySummary();
    summary.skips = [{ externalId: 'X', reason: 'partner_not_found' }];
    await capturePendingSkips(
      db,
      'organization' as CursorEntity,
      [rawByExt('X')],
      (r) => (r as { externalId: string }).externalId,
      summary
    );
    expect(upsert).not.toHaveBeenCalled();
  });
});

function pendingRow(over = {}) {
  return {
    id: 'pr1',
    entity: 'payment',
    externalId: 'P1',
    dto: {
      externalId: 'P1',
      amount: 1,
      paidAt: '2026-06-01T00:00:00Z',
      isRefund: false,
      organizationInn: '77',
      updatedAt: '2026-06-01T00:00:00Z',
    },
    reason: 'organization_not_found',
    attempts: 0,
    status: 'pending',
    firstSeenAt: new Date('2026-06-20T00:00:00Z'),
    lastTriedAt: new Date('2026-06-20T00:00:00Z'),
    ...over,
  };
}

describe('capturePendingSkips — thrown failures', () => {
  const rawByExt = (ext: string) => ({ externalId: ext, updatedAt: '2026-06-01T00:00:00Z' });

  it('upserts a pending row for each thrown failure with reason prefixed "threw:"', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { upsert } } as never;
    const raw = [rawByExt('P9')];
    const summary = emptySummary();
    summary.failures = [{ externalId: 'P9', error: 'deadlock' }];

    await capturePendingSkips(
      db,
      'payment' as CursorEntity,
      raw,
      (r) => (r as { externalId: string }).externalId,
      summary
    );

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ reason: 'threw: deadlock' }),
      })
    );
  });
});

describe('replayPendingRecords', () => {
  beforeEach(() => {
    upsertPaymentRecord.mockReset();
  });

  it('deletes the row when the writer now succeeds (dependency appeared)', async () => {
    upsertPaymentRecord.mockImplementation(
      async (_db: unknown, _dto: unknown, sum: { created: number }) => {
        sum.created += 1;
      }
    );
    const findMany = vi.fn().mockResolvedValue([pendingRow()]);
    const del = vi.fn().mockResolvedValue({});
    const update = vi.fn();
    const db = { oneCPendingRecord: { findMany, delete: del, update } } as never;
    const res = await replayPendingRecords(db, 'payment', {
      now: new Date('2026-06-21T00:00:00Z'),
    });
    expect(del).toHaveBeenCalledWith({ where: { id: 'pr1' } });
    expect(update).not.toHaveBeenCalled();
    expect(res).toMatchObject({ resolved: 1, deadLettered: 0, stillPending: 0 });
  });

  it('bumps attempts and keeps pending on a repeated transient skip below the cap', async () => {
    upsertPaymentRecord.mockImplementation(
      async (
        _db: unknown,
        _dto: unknown,
        sum: { skipped: number; skips: Array<{ externalId: string; reason: string }> }
      ) => {
        sum.skipped += 1;
        sum.skips.push({ externalId: 'P1', reason: 'organization_not_found' });
      }
    );
    const findMany = vi.fn().mockResolvedValue([pendingRow({ attempts: 2 })]);
    const del = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { findMany, delete: del, update } } as never;
    const res = await replayPendingRecords(db, 'payment', {
      now: new Date('2026-06-21T00:00:00Z'),
      maxAttempts: 50,
      maxAgeDays: 7,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pr1' },
      data: { attempts: 3, reason: 'organization_not_found' },
    });
    expect(del).not.toHaveBeenCalled();
    expect(res).toMatchObject({ resolved: 0, deadLettered: 0, stillPending: 1 });
  });

  it('dead-letters when attempts reach the cap', async () => {
    upsertPaymentRecord.mockImplementation(
      async (
        _db: unknown,
        _dto: unknown,
        sum: { skipped: number; skips: Array<{ externalId: string; reason: string }> }
      ) => {
        sum.skipped += 1;
        sum.skips.push({ externalId: 'P1', reason: 'organization_not_found' });
      }
    );
    const findMany = vi.fn().mockResolvedValue([pendingRow({ attempts: 49 })]);
    const update = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { findMany, delete: vi.fn(), update } } as never;
    const res = await replayPendingRecords(db, 'payment', {
      now: new Date('2026-06-21T00:00:00Z'),
      maxAttempts: 50,
      maxAgeDays: 7,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pr1' },
      data: { attempts: 50, status: 'dead', reason: 'organization_not_found' },
    });
    expect(res).toMatchObject({ deadLettered: 1 });
  });

  it('dead-letters a record older than the age cap regardless of attempts', async () => {
    upsertPaymentRecord.mockImplementation(
      async (
        _db: unknown,
        _dto: unknown,
        sum: { skipped: number; skips: Array<{ externalId: string; reason: string }> }
      ) => {
        sum.skipped += 1;
        sum.skips.push({ externalId: 'P1', reason: 'organization_not_found' });
      }
    );
    const findMany = vi
      .fn()
      .mockResolvedValue([
        pendingRow({ attempts: 1, firstSeenAt: new Date('2026-06-01T00:00:00Z') }),
      ]);
    const update = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { findMany, delete: vi.fn(), update } } as never;
    const res = await replayPendingRecords(db, 'payment', {
      now: new Date('2026-06-21T00:00:00Z'),
      maxAttempts: 50,
      maxAgeDays: 7,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pr1' },
      data: { attempts: 2, status: 'dead', reason: 'organization_not_found' },
    });
    expect(res).toMatchObject({ deadLettered: 1 });
  });

  it('keeps a thrown-writer record pending (retryable, not instant dead-letter) when below the attempt cap', async () => {
    upsertPaymentRecord.mockImplementation(async () => {
      throw new Error('deadlock');
    });
    const findMany = vi.fn().mockResolvedValue([pendingRow({ attempts: 2 })]);
    const del = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { findMany, delete: del, update } } as never;
    const res = await replayPendingRecords(db, 'payment', {
      now: new Date('2026-06-21T00:00:00Z'),
      maxAttempts: 50,
      maxAgeDays: 7,
    });
    // Must NOT contain status: 'dead'
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pr1' },
      data: { attempts: 3, reason: expect.stringContaining('deadlock') },
    });
    expect(del).not.toHaveBeenCalled();
    expect(res).toMatchObject({ resolved: 0, deadLettered: 0, stillPending: 1 });
  });

  it('dead-letters a thrown-writer record when attempts reach the cap', async () => {
    upsertPaymentRecord.mockImplementation(async () => {
      throw new Error('deadlock');
    });
    const findMany = vi.fn().mockResolvedValue([pendingRow({ attempts: 49 })]);
    const update = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { findMany, delete: vi.fn(), update } } as never;
    const res = await replayPendingRecords(db, 'payment', {
      now: new Date('2026-06-21T00:00:00Z'),
      maxAttempts: 50,
      maxAgeDays: 7,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pr1' },
      data: { attempts: 50, status: 'dead', reason: expect.stringContaining('deadlock') },
    });
    expect(res).toMatchObject({ deadLettered: 1 });
  });
});
