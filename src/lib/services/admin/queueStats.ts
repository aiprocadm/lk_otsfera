import type { Queue } from 'bullmq';
import { QUEUE_NAMES, getQueue, type QueueName } from '@/lib/jobs/queues';

type QueueCounts = {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
};

export type QueueStatsRow = {
  queue: QueueName;
  counts: QueueCounts;
};

export type DlqRow = {
  queue: QueueName;
  jobId: string;
  name: string;
  failedReason: string | null;
  failedAt: Date | null;
  attemptsMade: number;
};

const DLQ_LIMIT_PER_QUEUE = 50;

/**
 * Injection seam: the page/route loaders pass `getQueue` (or a stub in tests).
 */
export type QueueProvider = (
  name: QueueName
) => Pick<Queue, 'getJobCounts' | 'getFailed' | 'getJob'>;

/* v8 ignore next 1 — default provider is only used in production/integration; unit tests always inject a mock provider */
const defaultProvider: QueueProvider = (name) => getQueue(name);

export async function getQueueStats(
  provider: QueueProvider = defaultProvider
): Promise<QueueStatsRow[]> {
  const rows = await Promise.all(
    QUEUE_NAMES.map(async (queue) => {
      const counts = (await provider(queue).getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed'
      )) as Partial<QueueCounts>;
      return {
        queue,
        counts: {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        },
      };
    })
  );
  return rows;
}

export async function getDlq(provider: QueueProvider = defaultProvider): Promise<DlqRow[]> {
  const all: DlqRow[] = [];
  for (const queue of QUEUE_NAMES) {
    const jobs = await provider(queue).getFailed(0, DLQ_LIMIT_PER_QUEUE - 1);
    for (const job of jobs) {
      all.push({
        queue,
        jobId: String(job.id ?? ''),
        name: job.name,
        failedReason: job.failedReason ?? null,
        failedAt: job.finishedOn ? new Date(job.finishedOn) : null,
        attemptsMade: job.attemptsMade ?? 0,
      });
    }
  }
  // Newest failures first across all queues.
  all.sort((a, b) => (b.failedAt?.getTime() ?? 0) - (a.failedAt?.getTime() ?? 0));
  return all.slice(0, DLQ_LIMIT_PER_QUEUE);
}

export type RetryResult =
  { ok: true; queue: QueueName; jobId: string } | { ok: false; reason: string };

export async function retryDlqJob(
  queue: QueueName,
  jobId: string,
  provider: QueueProvider = defaultProvider
): Promise<RetryResult> {
  const job = await provider(queue).getJob(jobId);
  if (!job) return { ok: false, reason: 'JOB_NOT_FOUND' };
  try {
    await job.retry();
    return { ok: true, queue, jobId };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'RETRY_FAILED',
    };
  }
}

const BULK_RETRY_CAP = 500;

export type BulkRetryResult =
  | { ok: true; retried: number; failed: number; truncated: boolean }
  | { ok: false; error: 'queue_unavailable' };

/**
 * Retries up to BULK_RETRY_CAP failed jobs in one queue. Per-job retry errors
 * are counted (not thrown) so one stuck job can't block the batch. `truncated`
 * signals the cap was hit and more failures may remain. Audit is written by the
 * caller (route) — queueStats stays prisma-free.
 */
export async function retryAllDlq(
  queue: QueueName,
  provider: QueueProvider = defaultProvider
): Promise<BulkRetryResult> {
  try {
    const jobs = await provider(queue).getFailed(0, BULK_RETRY_CAP - 1);
    let retried = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        await job.retry();
        retried++;
      } catch {
        failed++;
      }
    }
    return { ok: true, retried, failed, truncated: jobs.length >= BULK_RETRY_CAP };
  } catch {
    return { ok: false, error: 'queue_unavailable' };
  }
}
