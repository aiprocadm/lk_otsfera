import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { syncOrdersProcessor } from '@/worker/processors/sync-orders';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

const { capturePendingSkips, replayPendingRecords } = vi.hoisted(() => ({
  capturePendingSkips: vi.fn().mockResolvedValue(undefined),
  replayPendingRecords: vi
    .fn()
    .mockResolvedValue({ resolved: 0, deadLettered: 0, stillPending: 0 }),
}));
vi.mock('@/lib/services/oneCSync/pending', () => ({
  capturePendingSkips,
  replayPendingRecords,
  isTransientSkip: () => true,
}));

const job = {
  id: 'shadow-1',
  data: { triggeredAt: '2026-05-01T00:00:00Z', reason: 'manual' as const },
} as Job<SyncJobPayload>;

function dbMock() {
  const orderCreate = vi.fn().mockResolvedValue({});
  const orderUpdate = vi.fn().mockResolvedValue({});
  const syncStateUpsert = vi.fn().mockResolvedValue({});
  const db = {
    syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: syncStateUpsert },
    organization: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: 'org1',
          partnerId: 'p1',
          companyId: 'c1',
          externalId: '1c-org-001',
        }),
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: orderCreate,
      update: orderUpdate,
    },
    syncLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaClient;
  return { db, orderCreate, orderUpdate, syncStateUpsert };
}

describe('syncOrdersProcessor shadow mode', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'shadow';
    resetOneCAdapter();
  });
  afterEach(() => {
    delete process.env.ONE_C_MODE;
    resetOneCAdapter();
  });

  it('counts wouldCreate without writing to the DB', async () => {
    const { db, orderCreate, orderUpdate } = dbMock();
    const result = await syncOrdersProcessor(job, db);
    expect(orderCreate).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0); // fixtures resolve to the mocked org
    expect(db.syncState.upsert as ReturnType<typeof vi.fn>).not.toHaveBeenCalled(); // cursor not advanced in shadow
    const logArg = (db.syncLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logArg.data.operation).toBe('check');
  });
});

describe('syncOrdersProcessor live mode', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'live';
    resetOneCAdapter();
  });
  afterEach(() => {
    delete process.env.ONE_C_MODE;
    resetOneCAdapter();
  });

  it('creates orders and advances cursor in live mode', async () => {
    const { db, orderCreate, syncStateUpsert } = dbMock();
    const result = await syncOrdersProcessor(job, db);

    // In live mode with no existing orders → creates all fixture orders
    expect(orderCreate).toHaveBeenCalled();
    // advanceCursor is called (syncState.upsert) — covers the `mode === 'live'` branch
    expect(syncStateUpsert).toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0);
    const logArg = (db.syncLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logArg.data.operation).toBe('create');
  });

  it('writes update operation log when all orders already exist (no new creates)', async () => {
    const existingOrder = {
      id: 'ord-existing',
      organizationId: 'org1',
      financialStatus: 'paid',
      orderNumber: 'OLD',
      title: 'Old title',
    };
    const orderUpdate = vi.fn().mockResolvedValue({});
    const syncStateUpsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: syncStateUpsert },
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org1', partnerId: 'p1', companyId: 'c1' }),
      },
      // Always return existing order so every record takes the UPDATE path → bump called multiple times
      order: {
        findUnique: vi.fn().mockResolvedValue(existingOrder),
        update: orderUpdate,
        create: vi.fn(),
      },
      syncLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const result = await syncOrdersProcessor(job, db);

    expect(result.updated).toBeGreaterThan(0);
    expect(result.created).toBe(0);
    // cursor advanced with the latest updatedAt from fixtures
    expect(syncStateUpsert).toHaveBeenCalled();
    // log shows 'update' operation (created=0, mode=live)
    const logArg = (db.syncLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logArg.data.operation).toBe('update');
  });
});

describe('syncOrdersProcessor record-level handler failure', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'shadow';
    resetOneCAdapter();
  });
  afterEach(() => {
    delete process.env.ONE_C_MODE;
    resetOneCAdapter();
  });

  it('accumulates per-record failures and covers the getExternalId lambda', async () => {
    // Making db.organization.findFirst throw causes upsertOrderRecord (the handler) to throw.
    // runRecordBatch catches it, calls getExternalId(record) (the (d) => d.externalId lambda),
    // and pushes to summary.failures.
    const syncStateUpsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: syncStateUpsert },
      organization: { findFirst: vi.fn().mockRejectedValue(new Error('handler_err')) },
      syncLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const result = await syncOrdersProcessor(job, db);
    // All records fail in the handler → summary.failed > 0
    expect(result.failed).toBeGreaterThan(0);
    // Each failure has the externalId from the getExternalId lambda
    expect(result.failures[0].externalId).toMatch(/^1c-order-/);
  });
});

describe('syncOrdersProcessor error path', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'shadow';
    resetOneCAdapter();
  });
  afterEach(() => {
    delete process.env.ONE_C_MODE;
    resetOneCAdapter();
  });

  it('calls markCursorError + writeSyncLog(skip/error) then re-throws when getCursor throws (Error instance)', async () => {
    const syncStateUpsert = vi.fn().mockResolvedValue({});
    const syncLogCreate = vi.fn().mockResolvedValue({});
    const db = {
      // getCursor calls syncState.findUnique — make it throw
      syncState: {
        findUnique: vi.fn().mockRejectedValue(new Error('DB_GONE')),
        upsert: syncStateUpsert,
      },
      syncLog: { create: syncLogCreate },
    } as unknown as PrismaClient;

    await expect(syncOrdersProcessor(job, db)).rejects.toThrow('DB_GONE');

    // markCursorError → syncState.upsert
    expect(syncStateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entity: 'order' } })
    );
    // writeSyncLog with status=error
    expect(syncLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: 'order', status: 'error', operation: 'skip' }),
      })
    );
  });

  it('covers non-Error thrown value path (String(err) branch)', async () => {
    const syncStateUpsert = vi.fn().mockResolvedValue({});
    const syncLogCreate = vi.fn().mockResolvedValue({});
    const db = {
      syncState: {
        findUnique: vi.fn().mockRejectedValue('string-error'),
        upsert: syncStateUpsert,
      },
      syncLog: { create: syncLogCreate },
    } as unknown as PrismaClient;

    await expect(syncOrdersProcessor(job, db)).rejects.toBe('string-error');

    expect(syncLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: 'string-error' }),
      })
    );
  });

  it('swallows markCursorError failure and still writes error log', async () => {
    const syncStateUpsert = vi.fn().mockRejectedValue(new Error('upsert_dead'));
    const syncLogCreate = vi.fn().mockResolvedValue({});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = {
      syncState: {
        findUnique: vi.fn().mockRejectedValue(new Error('MAIN_ERR')),
        upsert: syncStateUpsert,
      },
      syncLog: { create: syncLogCreate },
    } as unknown as PrismaClient;

    await expect(syncOrdersProcessor(job, db)).rejects.toThrow('MAIN_ERR');

    // The .catch() on markCursorError must have fired a console.warn
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[sync-orders]'),
      expect.anything()
    );
    // writeSyncLog still runs after markCursorError failure
    expect(syncLogCreate).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('syncOrdersProcessor pending capture+replay (live mode)', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'live';
    resetOneCAdapter();
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.ONE_C_MODE;
    resetOneCAdapter();
  });

  it('calls capturePendingSkips and replayPendingRecords in live mode', async () => {
    const { db } = dbMock();
    await syncOrdersProcessor(job, db);

    expect(capturePendingSkips).toHaveBeenCalledWith(
      db,
      'order',
      expect.any(Array),
      expect.any(Function),
      expect.any(Object)
    );
    expect(replayPendingRecords).toHaveBeenCalledWith(
      db,
      'order',
      expect.objectContaining({ now: expect.any(Date) })
    );
  });
});

describe('syncOrdersProcessor pending capture+replay (shadow mode)', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'shadow';
    resetOneCAdapter();
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.ONE_C_MODE;
    resetOneCAdapter();
  });

  it('does NOT call capturePendingSkips or replayPendingRecords in shadow mode', async () => {
    const { db } = dbMock();
    await syncOrdersProcessor(job, db);

    expect(capturePendingSkips).not.toHaveBeenCalled();
    expect(replayPendingRecords).not.toHaveBeenCalled();
  });
});
