import type { Job } from 'bullmq';
import type { SyncJobPayload } from '@/lib/jobs/types';

export async function syncOrdersProcessor(job: Job<SyncJobPayload>): Promise<{ ok: true }> {
  console.log('[worker] sync-orders job started', { id: job.id, payload: job.data });
  return { ok: true };
}
