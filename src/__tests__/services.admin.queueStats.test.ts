import { describe, it, expect, vi } from 'vitest';
import { QUEUE_NAMES } from '@/lib/jobs/queues';
import {
  getQueueStats,
  getDlq,
  retryDlqJob,
  retryAllDlq,
  type QueueProvider,
} from '@/lib/services/admin/queueStats';

function makeProvider(overrides: Record<string, Partial<{
  getJobCounts: ReturnType<typeof vi.fn>;
  getFailed: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
}>> = {}): QueueProvider {
  return (name) => {
    const base = {
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
      getFailed: vi.fn().mockResolvedValue([]),
      getJob: vi.fn().mockResolvedValue(null),
    };
    return { ...base, ...overrides[name] } as unknown as Parameters<QueueProvider>[0] extends string
      ? ReturnType<QueueProvider>
      : never;
  };
}

describe('getQueueStats', () => {
  it('returns one row per QUEUE_NAMES with normalized counts', async () => {
    const provider = makeProvider();
    const rows = await getQueueStats(provider);
    expect(rows).toHaveLength(QUEUE_NAMES.length);
    expect(rows[0].counts).toEqual({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 });
  });

  it('fills missing count keys with 0 even if BullMQ omits them', async () => {
    const provider: QueueProvider = (name) => ({
      // BullMQ sometimes returns partial map (e.g. when no jobs of that status).
      getJobCounts: vi.fn().mockResolvedValue(name === 'docs.scanDocument' ? { failed: 3 } : {}),
      getFailed: vi.fn().mockResolvedValue([]),
      getJob: vi.fn(),
    } as any);
    const rows = await getQueueStats(provider);
    const scan = rows.find((r) => r.queue === 'docs.scanDocument');
    expect(scan?.counts).toEqual({ waiting: 0, active: 0, completed: 0, failed: 3, delayed: 0 });
  });
});

describe('getDlq', () => {
  it('returns empty array when no queue has failures', async () => {
    const rows = await getDlq(makeProvider());
    expect(rows).toEqual([]);
  });

  it('sorts failed jobs by finishedOn desc and caps at 50', async () => {
    const now = Date.now();
    const provider: QueueProvider = (name) => ({
      getJobCounts: vi.fn(),
      getFailed: vi.fn().mockResolvedValue(
        name === 'docs.scanDocument'
          ? [
              { id: 'old', name: 'scan', failedReason: 'A', finishedOn: now - 5000, attemptsMade: 3 },
              { id: 'new', name: 'scan', failedReason: 'B', finishedOn: now - 1000, attemptsMade: 2 },
            ]
          : [],
      ),
      getJob: vi.fn(),
    } as any);
    const rows = await getDlq(provider);
    expect(rows).toHaveLength(2);
    expect(rows[0].jobId).toBe('new');
    expect(rows[1].jobId).toBe('old');
    expect(rows[0].queue).toBe('docs.scanDocument');
    expect(rows[0].failedReason).toBe('B');
  });
});

describe('retryDlqJob', () => {
  it('returns JOB_NOT_FOUND when queue.getJob is null', async () => {
    const provider: QueueProvider = () => ({
      getJobCounts: vi.fn(),
      getFailed: vi.fn(),
      getJob: vi.fn().mockResolvedValue(null),
    } as any);
    const result = await retryDlqJob('docs.scanDocument', 'unknown', provider);
    expect(result).toEqual({ ok: false, reason: 'JOB_NOT_FOUND' });
  });

  it('calls job.retry() and returns ok with queue+jobId', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const provider: QueueProvider = () => ({
      getJobCounts: vi.fn(),
      getFailed: vi.fn(),
      getJob: vi.fn().mockResolvedValue({ retry }),
    } as any);
    const result = await retryDlqJob('docs.scanDocument', 'job-1', provider);
    expect(retry).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, queue: 'docs.scanDocument', jobId: 'job-1' });
  });

  it('captures retry errors and returns ok:false with reason', async () => {
    const provider: QueueProvider = () => ({
      getJobCounts: vi.fn(),
      getFailed: vi.fn(),
      getJob: vi.fn().mockResolvedValue({
        retry: vi.fn().mockRejectedValue(new Error('Job is not failed')),
      }),
    } as any);
    const result = await retryDlqJob('docs.scanDocument', 'job-1', provider);
    expect(result).toEqual({ ok: false, reason: 'Job is not failed' });
  });
});

describe('retryAllDlq', () => {
  it('retries every failed job and counts successes/failures', async () => {
    const okJob = { retry: vi.fn().mockResolvedValue(undefined) };
    const badJob = { retry: vi.fn().mockRejectedValue(new Error('not failed')) };
    const provider: QueueProvider = () => ({
      getJobCounts: vi.fn(),
      getFailed: vi.fn().mockResolvedValue([okJob, okJob, badJob]),
      getJob: vi.fn(),
    } as any);
    const res = await retryAllDlq('docs.scanDocument', provider);
    expect(res).toEqual({ ok: true, retried: 2, failed: 1, truncated: false });
  });

  it('flags truncated when the failed page is full (>= cap)', async () => {
    const job = { retry: vi.fn().mockResolvedValue(undefined) };
    const full = Array.from({ length: 500 }, () => job);
    const provider: QueueProvider = () => ({
      getJobCounts: vi.fn(),
      getFailed: vi.fn().mockResolvedValue(full),
      getJob: vi.fn(),
    } as any);
    const res = await retryAllDlq('docs.scanDocument', provider);
    expect(res).toEqual({ ok: true, retried: 500, failed: 0, truncated: true });
  });

  it('returns queue_unavailable when getFailed throws', async () => {
    const provider: QueueProvider = () => ({
      getJobCounts: vi.fn(),
      getFailed: vi.fn().mockRejectedValue(new Error('redis down')),
      getJob: vi.fn(),
    } as any);
    expect(await retryAllDlq('docs.scanDocument', provider)).toEqual({ ok: false, error: 'queue_unavailable' });
  });
});
