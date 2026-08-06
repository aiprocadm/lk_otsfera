import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { syncOrganizationsProcessor } from '@/worker/processors/sync-organizations';
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
  id: 'shadow-org',
  data: { triggeredAt: '2026-05-01T00:00:00Z', reason: 'manual' as const },
} as Job<SyncJobPayload>;

describe('syncOrganizationsProcessor shadow mode', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'shadow';
    // Этап 6 (Т-41): без компании create-ветка честно падает company_not_configured —
    // для проверки «shadow не пишет, но считает» компания должна быть задана.
    process.env.ONE_C_COMPANY_ID = 'co-sync';
    resetOneCAdapter();
  });
  afterEach(() => {
    delete process.env.ONE_C_MODE;
    delete process.env.ONE_C_COMPANY_ID;
    resetOneCAdapter();
  });

  it('does not create records or advance cursor', async () => {
    const create = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      organization: {
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        update,
        create,
      },
      syncLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const result = await syncOrganizationsProcessor(job, db);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0);
  });
});

describe('syncOrganizationsProcessor live mode', () => {
  beforeEach(() => {
    process.env.ONE_C_ADAPTER = 'fake';
    process.env.ONE_C_MODE = 'live';
    process.env.ONE_C_COMPANY_ID = 'co-sync';
    resetOneCAdapter();
  });
  afterEach(() => {
    delete process.env.ONE_C_MODE;
    delete process.env.ONE_C_COMPANY_ID;
    resetOneCAdapter();
  });

  // Use the UPDATE path (existing organizations) to cover live mode without
  // needing to run a real $transaction mock.
  it('updates existing organizations and advances cursor in live mode', async () => {
    const update = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'org-existing', companyId: 'co1' }),
        update,
      },
      syncLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const result = await syncOrganizationsProcessor(job, db);

    expect(update).toHaveBeenCalled();
    // advanceCursor called — covers mode==='live' branch
    expect(upsert).toHaveBeenCalled();
    expect(result.updated).toBeGreaterThan(0);
    expect(result.created).toBe(0);
    const logArg = (db.syncLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logArg.data.operation).toBe('update');
  });

  // Covers the `summary.created > 0 ? 'create' : 'update'` TRUE branch in the
  // writeSyncLog call. organization.findUnique returns null → CREATE path.
  // Этап 6 (Т-41): Company не минтится — организация создаётся в компании из
  // ONE_C_COMPANY_ID одним organization.create.
  it('writes create operation log when new organizations are created (created>0 branch)', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const orgCreate = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      // Return null for both externalId (findUnique) and inn (findFirst) lookups →
      // upsertOrgRecord takes the CREATE path
      organization: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: orgCreate,
      },
      syncLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const result = await syncOrganizationsProcessor(job, db);

    expect(orgCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'co-sync' }),
      select: { id: true },
    });
    expect(result.created).toBeGreaterThan(0);
    const logArg = (db.syncLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // summary.created > 0 → operation must be 'create' (not 'update')
    expect(logArg.data.operation).toBe('create');
  });

  // Т-41: конфиг не задан → создание невозможно, но это ЯВНАЯ построчная ошибка
  // в отчёте + log.error, а не молчаливый минт тенанта (и не остановка обновлений).
  it('без ONE_C_COMPANY_ID create-строки падают company_not_configured с log.error', async () => {
    delete process.env.ONE_C_COMPANY_ID;
    const orgCreate = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
      partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: orgCreate,
      },
      syncLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const result = await syncOrganizationsProcessor(job, db);

    expect(orgCreate).not.toHaveBeenCalled();
    expect(result.failed).toBeGreaterThan(0);
    expect(result.failures[0]).toMatchObject({ error: 'company_not_configured' });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ONE_C_COMPANY_ID'));
    errorSpy.mockRestore();
  });
});

describe('syncOrganizationsProcessor record-level handler failure', () => {
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
    // Making db.partner.findFirst throw causes upsertOrgRecord to fail per-record.
    // runRecordBatch catches it and calls (dto) => dto.externalId to log the failure.
    const db = {
      syncState: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      partner: { findFirst: vi.fn().mockRejectedValue(new Error('partner_err')) },
      organization: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
      $transaction: vi.fn(),
      syncLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const result = await syncOrganizationsProcessor(job, db);
    expect(result.failed).toBeGreaterThan(0);
    expect(result.failures[0].externalId).toMatch(/^1c-org-/);
  });
});

describe('syncOrganizationsProcessor error path', () => {
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
      syncState: {
        findUnique: vi.fn().mockRejectedValue(new Error('DB_GONE')),
        upsert: syncStateUpsert,
      },
      syncLog: { create: syncLogCreate },
    } as unknown as PrismaClient;

    await expect(syncOrganizationsProcessor(job, db)).rejects.toThrow('DB_GONE');

    expect(syncStateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entity: 'organization' } })
    );
    expect(syncLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: 'organization',
          status: 'error',
          operation: 'skip',
        }),
      })
    );
  });

  it('covers non-Error thrown value (String branch)', async () => {
    const db = {
      syncState: {
        findUnique: vi.fn().mockRejectedValue('str-err'),
        upsert: vi.fn().mockResolvedValue({}),
      },
      syncLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    await expect(syncOrganizationsProcessor(job, db)).rejects.toBe('str-err');

    expect(db.syncLog.create as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: 'str-err' }),
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

    await expect(syncOrganizationsProcessor(job, db)).rejects.toThrow('MAIN_ERR');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[sync-organizations]'),
      expect.anything()
    );
    expect(syncLogCreate).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('syncOrganizationsProcessor pending capture+replay (live mode)', () => {
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
    const update = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'org-existing', companyId: 'co1' }),
        update,
      },
      syncLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    await syncOrganizationsProcessor(job, db);

    expect(capturePendingSkips).toHaveBeenCalledWith(
      db,
      'organization',
      expect.any(Array),
      expect.any(Function),
      expect.any(Object)
    );
    expect(replayPendingRecords).toHaveBeenCalledWith(
      db,
      'organization',
      expect.objectContaining({ now: expect.any(Date) })
    );
  });
});

describe('syncOrganizationsProcessor pending capture+replay (shadow mode)', () => {
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
    const db = {
      syncState: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({}),
      },
      partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'org-existing', companyId: 'co1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      syncLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    await syncOrganizationsProcessor(job, db);

    expect(capturePendingSkips).not.toHaveBeenCalled();
    expect(replayPendingRecords).not.toHaveBeenCalled();
  });
});
