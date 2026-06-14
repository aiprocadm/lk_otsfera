import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { syncOrdersProcessor } from '@/worker/processors/sync-orders';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

const job = { id: 'shadow-1', data: { triggeredAt: '2026-05-01T00:00:00Z', reason: 'manual' as const } } as Job<SyncJobPayload>;

function dbMock() {
  const orderCreate = vi.fn().mockResolvedValue({});
  const orderUpdate = vi.fn().mockResolvedValue({});
  const db = {
    syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    organization: { findFirst: vi.fn().mockResolvedValue({ id: 'org1', partnerId: 'p1', companyId: 'c1', externalId: '1c-org-001' }) },
    order: { findUnique: vi.fn().mockResolvedValue(null), create: orderCreate, update: orderUpdate },
    syncLog: { create: vi.fn().mockResolvedValue({}) }
  } as unknown as PrismaClient;
  return { db, orderCreate, orderUpdate };
}

describe('syncOrdersProcessor shadow mode', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('counts wouldCreate without writing to the DB', async () => {
    const { db, orderCreate, orderUpdate } = dbMock();
    const result = await syncOrdersProcessor(job, db);
    expect(orderCreate).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0); // fixtures resolve to the mocked org
    expect((db.syncState.upsert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled(); // cursor not advanced in shadow
    const logArg = (db.syncLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logArg.data.operation).toBe('check');
  });
});
