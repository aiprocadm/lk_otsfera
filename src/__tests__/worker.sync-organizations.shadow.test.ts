import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { syncOrganizationsProcessor } from '@/worker/processors/sync-organizations';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

const job = { id: 'shadow-org', data: { triggeredAt: '2026-05-01T00:00:00Z', reason: 'manual' as const } } as Job<SyncJobPayload>;

describe('syncOrganizationsProcessor shadow mode', () => {
  beforeEach(() => { process.env.ONE_C_ADAPTER = 'fake'; process.env.ONE_C_MODE = 'shadow'; resetOneCAdapter(); });
  afterEach(() => { delete process.env.ONE_C_MODE; resetOneCAdapter(); });

  it('does not run the create transaction or advance cursor', async () => {
    const tx = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    const upsert = vi.fn().mockResolvedValue({});
    const db = {
      syncState: { findUnique: vi.fn().mockResolvedValue(null), upsert },
      partner: { findUnique: vi.fn().mockResolvedValue({ id: 'p1' }) },
      organization: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null), update },
      $transaction: tx,
      syncLog: { create: vi.fn().mockResolvedValue({}) }
    } as unknown as PrismaClient;

    const result = await syncOrganizationsProcessor(job, db);
    expect(tx).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(result.created).toBeGreaterThan(0);
  });
});
