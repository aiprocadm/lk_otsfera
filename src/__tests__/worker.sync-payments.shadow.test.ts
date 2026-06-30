import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { syncPaymentsProcessor } from '@/worker/processors/sync-payments';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

const { capturePendingSkips, replayPendingRecords } = vi.hoisted(() => ({
  capturePendingSkips: vi.fn().mockResolvedValue(undefined),
  replayPendingRecords: vi.fn().mockResolvedValue({ resolved: 0, deadLettered: 0, stillPending: 0 }),
}));
vi.mock('@/lib/services/oneCSync/pending', () => ({ capturePendingSkips, replayPendingRecords, isTransientSkip: () => true }));

const job = { id: 'shadow-pay', data: { triggeredAt: '2026-05-01T00:00:00Z', reason: 'manual' as const } } as Job<SyncJobPayload>;

describe('syncPaymentsProcessor shadow mode', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('does not create/update payments and does not advance cursor', async () => {
    const create = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', organizationId: 'org1', orderNumber: 'N', title: 'T' }) },
      payment: { findUnique: vi.fn().mockResolvedValue(null), create, update },
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    const result = await syncPaymentsProcessor(job, db);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0);
  });
});

describe('syncPaymentsProcessor record-level handler failure', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('accumulates per-record failures and covers the getExternalId lambda', async () => {
    // Making db.order.findUnique throw causes upsertPaymentRecord to fail per-record.
    // runRecordBatch catches it and calls (dto) => dto.externalId to log the failure.
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
      order: { findUnique: vi.fn().mockRejectedValue(new Error('order_db_err')) },
      payment: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    const result = await syncPaymentsProcessor(job, db);
    expect(result.failed).toBeGreaterThan(0);
    expect(result.failures[0].externalId).toMatch(/^1c-pay-/);
  });
});

describe('syncPaymentsProcessor error path', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('calls markCursorError + writeSyncLog(skip/error) then re-throws when getCursor throws (Error instance)', async () => {
    const syncStateUpsert = vi.fn().mockResolvedValue({});
    const syncLogCreate = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockRejectedValue(new Error('DB_GONE')), upsert: syncStateUpsert },
      syncLog: { create: syncLogCreate }
    } as unknown as PrismaClient;

    await expect(syncPaymentsProcessor(job, db)).rejects.toThrow('DB_GONE');

    expect(syncStateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entity: 'payment' } })
    );
    expect(syncLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: 'payment', status: 'error', operation: 'skip' })
      })
    );
  });

  it('covers non-Error thrown value (String branch)', async () => {
    const db = {
      syncState: { findUnique: vi.fn().mockRejectedValue('raw-string'), upsert: vi.fn().mockResolvedValue({}) },
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    await expect(syncPaymentsProcessor(job, db)).rejects.toBe('raw-string');

    expect((db.syncLog.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: 'raw-string' })
      })
    );
  });

  it('swallows markCursorError failure and still writes error log', async () => {
    const syncStateUpsert = vi.fn().mockRejectedValue(new Error('upsert_dead'));
    const syncLogCreate = vi.fn().mockResolvedValue({});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = {
      syncState: { findUnique: vi.fn().mockRejectedValue(new Error('MAIN_ERR')), upsert: syncStateUpsert },
      syncLog: { create: syncLogCreate }
    } as unknown as PrismaClient;

    await expect(syncPaymentsProcessor(job, db)).rejects.toThrow('MAIN_ERR');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[sync-payments]'),
      expect.anything()
    );
    expect(syncLogCreate).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('syncPaymentsProcessor pending capture+replay (live mode)', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'live';
    resetOneCAdapter();
    vi.clearAllMocks();
  });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('calls capturePendingSkips and replayPendingRecords in live mode', async () => {
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', organizationId: 'org1', orderNumber: 'N', title: 'T' }) },
      payment: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
      syncLog: { create: vi.fn().mockResolvedValue({}) },
      oneCPendingRecord: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue({ count: 0 }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) }
    } as unknown as PrismaClient;

    await syncPaymentsProcessor(job, db);

    expect(capturePendingSkips).toHaveBeenCalledWith(db, 'payment', expect.any(Array), expect.any(Function), expect.any(Object));
    expect(replayPendingRecords).toHaveBeenCalledWith(db, 'payment', expect.objectContaining({ now: expect.any(Date) }));
  });
});

describe('syncPaymentsProcessor pending capture+replay (shadow mode)', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'shadow';
    resetOneCAdapter();
    vi.clearAllMocks();
  });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('does NOT call capturePendingSkips or replayPendingRecords in shadow mode', async () => {
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', organizationId: 'org1', orderNumber: 'N', title: 'T' }) },
      payment: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    await syncPaymentsProcessor(job, db);

    expect(capturePendingSkips).not.toHaveBeenCalled();
    expect(replayPendingRecords).not.toHaveBeenCalled();
  });
});
