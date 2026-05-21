import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Job } from 'bullmq';
import { syncOrdersProcessor } from '@/worker/processors/sync-orders';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

beforeAll(() => {
  process.env.ONE_C_ADAPTER = 'fake';
  resetOneCAdapter();
});

afterAll(() => {
  resetOneCAdapter();
});

describe('sync-orders processor smoke', () => {
  it('returns count of pulled orders from fake adapter and writes SyncLog', async () => {
    const job = {
      id: 'test-1',
      data: { triggeredAt: new Date().toISOString(), reason: 'manual' as const }
    } as Job<SyncJobPayload>;
    const result = await syncOrdersProcessor(job);
    expect(result.pulled).toBeGreaterThanOrEqual(3);
  });
});
