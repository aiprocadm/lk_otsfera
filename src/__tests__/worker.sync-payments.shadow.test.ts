import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { syncPaymentsProcessor } from '@/worker/processors/sync-payments';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

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
