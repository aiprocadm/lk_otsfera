import { describe, expect, it, vi } from 'vitest';
import { registerSyncSchedules, SYNC_SCHEDULES, loadPausedSchedulerIds } from '@/lib/jobs/scheduling';
import type { Queue } from 'bullmq';

function makeFakeQueue() {
  return {
    upsertJobScheduler: vi.fn().mockResolvedValue({ id: 'scheduled-job-id' })
  } as unknown as Queue;
}

describe('registerSyncSchedules', () => {
  it('registers all 5 scheduled jobs (4 pulls + reconcile)', async () => {
    const queues = new Map<string, Queue>();
    const getQueue = (name: string) => {
      const existing = queues.get(name);
      if (existing) return existing;
      const fake = makeFakeQueue();
      queues.set(name, fake);
      return fake;
    };

    const result = await registerSyncSchedules(getQueue as never);
    expect(result).toHaveLength(SYNC_SCHEDULES.length);
    expect(result).toHaveLength(5);
    const queueNames = result.map((r) => r.queueName).sort();
    expect(queueNames).toEqual(
      [
        'oneCSync.pullDocuments',
        'oneCSync.pullOrders',
        'oneCSync.pullOrganizations',
        'oneCSync.pullPayments',
        'oneCSync.reconcile'
      ].sort()
    );
  });

  it('uses Europe/Moscow timezone for every schedule', async () => {
    const calls: Array<{ schedulerId: string; opts: { pattern?: string; tz?: string } }> = [];
    const getQueue = () =>
      ({
        upsertJobScheduler: vi.fn(async (id: string, opts) => {
          calls.push({ schedulerId: id, opts: opts as { pattern?: string; tz?: string } });
          return { id };
        })
      } as unknown as Queue);
    await registerSyncSchedules(getQueue as never);
    expect(calls.length).toBe(5);
    for (const c of calls) {
      expect(c.opts.tz).toBe('Europe/Moscow');
      expect(c.opts.pattern).toBeTruthy();
    }
  });

  it('uses fixed schedulerId per queue (idempotent on re-registration)', async () => {
    const observedSchedulerIds: string[] = [];
    const getQueue = () =>
      ({
        upsertJobScheduler: vi.fn(async (id: string) => {
          observedSchedulerIds.push(id);
          return { id };
        })
      } as unknown as Queue);

    await registerSyncSchedules(getQueue as never);
    await registerSyncSchedules(getQueue as never);

    const unique = new Set(observedSchedulerIds);
    expect(observedSchedulerIds.length).toBe(10);
    expect(unique.size).toBe(5);
  });

  it('passes reason=cron in job data so SyncLog can distinguish triggered source', async () => {
    const dataSpy: unknown[] = [];
    const getQueue = () =>
      ({
        upsertJobScheduler: vi.fn(async (id: string, _opts, template) => {
          dataSpy.push((template as { data?: unknown })?.data);
          return { id };
        })
      } as unknown as Queue);
    await registerSyncSchedules(getQueue as never);
    for (const d of dataSpy) {
      expect((d as { reason?: string }).reason).toBe('cron');
      expect((d as { triggeredAt?: string }).triggeredAt).toBeTruthy();
    }
  });
});

describe('registerSyncSchedules — paused skipping', () => {
  it('skips schedules whose schedulerId is paused', async () => {
    const getQueue = () => ({ upsertJobScheduler: vi.fn(async (id: string) => ({ id })) } as unknown as Queue);
    const result = await registerSyncSchedules(getQueue as never, new Set(['oneCSync.pullOrders.cron']));
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.schedulerId)).not.toContain('oneCSync.pullOrders.cron');
  });
});

describe('loadPausedSchedulerIds', () => {
  it('returns a Set of paused schedulerIds from the DB', async () => {
    const prisma = {
      syncSchedulePause: { findMany: vi.fn().mockResolvedValue([{ schedulerId: 'a' }, { schedulerId: 'b' }]) },
    } as never;
    const set = await loadPausedSchedulerIds(prisma);
    expect(set).toEqual(new Set(['a', 'b']));
  });
});
