import type { Job } from 'bullmq';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { writeSyncLog } from '@/lib/services/oneCSync/log';

export type SyncOrdersResult = {
  pulled: number;
};

export async function syncOrdersProcessor(
  job: Job<SyncJobPayload>
): Promise<SyncOrdersResult> {
  const startedAt = Date.now();
  console.log('[worker] sync-orders job started', { id: job.id });
  try {
    const adapter = getOneCAdapter();
    const orders = await adapter.pullOrders({});
    await writeSyncLog({
      entity: 'order',
      direction: 'inbound',
      operation: 'skip',
      status: 'success',
      payload: { pulled: orders.length, note: 'no upsert in phase 0' },
      durationMs: Date.now() - startedAt
    });
    return { pulled: orders.length };
  } catch (err) {
    await writeSyncLog({
      entity: 'order',
      direction: 'inbound',
      operation: 'skip',
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt
    });
    throw err;
  }
}
