import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { syncDocumentsProcessor } from '@/worker/processors/sync-documents';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

// Mock fetchAndStore1CDocument so the CREATE path in live mode can be exercised
// without a live object storage (S3) connection (writers.ts calls it when existing=null).
vi.mock('@/lib/services/oneCSync/document-fetch', () => ({
  fetchAndStore1CDocument: vi.fn().mockResolvedValue('fake/storage/path.pdf')
}));

// Mock the scan queue enqueue so createDoc path doesn't attempt Redis connections.
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: vi.fn().mockReturnValue({ add: vi.fn().mockResolvedValue({}) })
}));

const { capturePendingSkips, replayPendingRecords } = vi.hoisted(() => ({
  capturePendingSkips: vi.fn().mockResolvedValue(undefined),
  replayPendingRecords: vi.fn().mockResolvedValue({ resolved: 0, deadLettered: 0, stillPending: 0 }),
}));
vi.mock('@/lib/services/oneCSync/pending', () => ({ capturePendingSkips, replayPendingRecords, isTransientSkip: () => true }));

const job = { id: 'shadow-doc', data: { triggeredAt: '2026-05-01T00:00:00Z', reason: 'manual' as const } } as Job<SyncJobPayload>;

// All three fixture documents reference order 1c-order-1001; a single order stub covers them.
function makeExistingDocDb() {
  const update = vi.fn().mockResolvedValue({});
  const upsert = vi.fn().mockResolvedValue({});
  const db = {
    syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
    order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', organizationId: null, orderNumber: 'N', title: 'T' }) },
    document: { findUnique: vi.fn().mockResolvedValue({ id: 'doc-existing' }), create: vi.fn(), update },
    syncLog: { create: vi.fn().mockResolvedValue({}) }
  } as unknown as PrismaClient;
  return { db, update, upsert };
}

describe('syncDocumentsProcessor shadow mode', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('does not create/update documents and does not advance cursor', async () => {
    const create = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', organizationId: 'org1', orderNumber: 'N', title: 'T' }) },
      document: { findUnique: vi.fn().mockResolvedValue(null), create, update },
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    const result = await syncDocumentsProcessor(job, db);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0);
  });
});

describe('syncDocumentsProcessor live mode', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'live'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  // Use the UPDATE path (existing documents) to cover live mode without needing
  // fetchAndStore1CDocument or Redis queue mocks.
  it('updates existing documents and advances cursor in live mode (covers advanceCursor + bump branches)', async () => {
    const { db, update, upsert } = makeExistingDocDb();

    const result = await syncDocumentsProcessor(job, db);

    // live mode: existing docs → db.document.update is called
    expect(update).toHaveBeenCalled();
    // advanceCursor fires (syncState.upsert) — covers mode==='live' branch
    expect(upsert).toHaveBeenCalled();
    // Multiple fixture documents with distinct updatedAt → bump called 3× →
    // exercises both `!maxUpdatedAt` (1st call) and `t > maxUpdatedAt` (2nd call)
    // and `t <= maxUpdatedAt` (3rd call, 2026-05-05 < 2026-05-15).
    expect(result.updated).toBeGreaterThan(0);
    expect(result.created).toBe(0);
    const logArg = (db.syncLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logArg.data.operation).toBe('update');
  });

  // Covers the `summary.created > 0 ? 'create' : 'update'` TRUE branch in the
  // writeSyncLog call — only reachable when at least one document is newly stored.
  // fetchAndStore1CDocument is mocked at the top of this file to return a fake path.
  it('writes create operation log when new documents are fetched and stored (created>0 branch)', async () => {
    const docCreate = vi.fn().mockResolvedValue({ id: 'new-doc-1' });
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      order: { findUnique: vi.fn().mockResolvedValue({ id: 'o1', organizationId: null, orderNumber: 'N', title: 'T' }) },
      // Return null so every fixture doc takes the CREATE path → sum.created > 0
      document: { findUnique: vi.fn().mockResolvedValue(null), create: docCreate, update: vi.fn() },
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    const result = await syncDocumentsProcessor(job, db);

    expect(docCreate).toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0);
    const logArg = (db.syncLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // summary.created > 0 → operation must be 'create' (not 'update')
    expect(logArg.data.operation).toBe('create');
  });
});

describe('syncDocumentsProcessor record-level handler failure', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('accumulates per-record failures and covers the getExternalId lambda', async () => {
    // Making db.order.findUnique throw causes upsertDocumentRecord to fail per-record.
    // runRecordBatch catches it and calls (dto) => dto.externalId to log the failure.
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
      order: { findUnique: vi.fn().mockRejectedValue(new Error('order_err')) },
      document: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    const result = await syncDocumentsProcessor(job, db);
    expect(result.failed).toBeGreaterThan(0);
    expect(result.failures[0].externalId).toMatch(/^1c-doc-/);
  });
});

describe('syncDocumentsProcessor error path', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('calls markCursorError + writeSyncLog(skip/error) then re-throws when getCursor throws (Error instance)', async () => {
    const syncStateUpsert = vi.fn().mockResolvedValue({});
    const syncLogCreate = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockRejectedValue(new Error('DB_DOWN')), upsert: syncStateUpsert },
      syncLog: { create: syncLogCreate }
    } as unknown as PrismaClient;

    await expect(syncDocumentsProcessor(job, db)).rejects.toThrow('DB_DOWN');

    expect(syncStateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entity: 'document' } })
    );
    expect(syncLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: 'document', status: 'error', operation: 'skip' })
      })
    );
  });

  it('covers non-Error thrown value (String branch)', async () => {
    const db = {
      syncState: { findUnique: vi.fn().mockRejectedValue('raw-string'), upsert: vi.fn().mockResolvedValue({}) },
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    await expect(syncDocumentsProcessor(job, db)).rejects.toBe('raw-string');

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

    await expect(syncDocumentsProcessor(job, db)).rejects.toThrow('MAIN_ERR');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[sync-documents]'),
      expect.anything()
    );
    expect(syncLogCreate).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('syncDocumentsProcessor pending capture+replay (live mode)', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'live';
    resetOneCAdapter();
    vi.clearAllMocks();
  });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('calls capturePendingSkips and replayPendingRecords in live mode', async () => {
    const { db } = makeExistingDocDb();
    await syncDocumentsProcessor(job, db);

    expect(capturePendingSkips).toHaveBeenCalledWith(db, 'document', expect.any(Array), expect.any(Function), expect.any(Object));
    expect(replayPendingRecords).toHaveBeenCalledWith(db, 'document', expect.objectContaining({ now: expect.any(Date) }));
  });
});

describe('syncDocumentsProcessor pending capture+replay (shadow mode)', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'shadow';
    resetOneCAdapter();
    vi.clearAllMocks();
  });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('does NOT call capturePendingSkips or replayPendingRecords in shadow mode', async () => {
    const { db } = makeExistingDocDb();
    await syncDocumentsProcessor(job, db);

    expect(capturePendingSkips).not.toHaveBeenCalled();
    expect(replayPendingRecords).not.toHaveBeenCalled();
  });
});
