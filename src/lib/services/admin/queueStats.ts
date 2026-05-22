import type { Queue } from 'bullmq';
import { QUEUE_NAMES, getQueue, type QueueName } from '@/lib/jobs/queues';

export type QueueCounts = {
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
export type QueueProvider = (name: QueueName) => Pick<
  Queue,
  'getJobCounts' | 'getFailed' | 'getJob'
>;

const defaultProvider: QueueProvider = (name) => getQueue(name);

export async function getQueueStats(
  provider: QueueProvider = defaultProvider,
): Promise<QueueStatsRow[]> {
  const rows = await Promise.all(
    QUEUE_NAMES.map(async (queue) => {
      const counts = (await provider(queue).getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
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
    }),
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

export type RetryResult = { ok: true; queue: QueueName; jobId: string } | { ok: false; reason: string };

export async function retryDlqJob(
  queue: QueueName,
  jobId: string,
  provider: QueueProvider = defaultProvider,
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
