import type { Queue } from 'bullmq';
import { getQueue, type QueueName } from './queues';
import type { SyncJobPayload } from './types';

export type SyncScheduleQueueName = Extract<
  QueueName,
  | 'oneCSync.pullOrders'
  | 'oneCSync.pullPayments'
  | 'oneCSync.pullDocuments'
  | 'oneCSync.pullOrganizations'
  | 'oneCSync.reconcile'
>;

export type SyncSchedule = {
  queueName: SyncScheduleQueueName;
  schedulerId: string;
  pattern: string;
  tz: string;
};

export const DEFAULT_SYNC_TZ = 'Europe/Moscow';

export const SYNC_SCHEDULES: ReadonlyArray<SyncSchedule> = [
  {
    queueName: 'oneCSync.pullOrders',
    schedulerId: 'oneCSync.pullOrders.cron',
    pattern: '*/15 * * * *',
    tz: DEFAULT_SYNC_TZ
  },
  {
    queueName: 'oneCSync.pullPayments',
    schedulerId: 'oneCSync.pullPayments.cron',
    pattern: '*/15 * * * *',
    tz: DEFAULT_SYNC_TZ
  },
  {
    queueName: 'oneCSync.pullDocuments',
    schedulerId: 'oneCSync.pullDocuments.cron',
    pattern: '0 * * * *',
    tz: DEFAULT_SYNC_TZ
  },
  {
    queueName: 'oneCSync.pullOrganizations',
    schedulerId: 'oneCSync.pullOrganizations.cron',
    pattern: '0 */6 * * *',
    tz: DEFAULT_SYNC_TZ
  },
  {
    queueName: 'oneCSync.reconcile',
    schedulerId: 'oneCSync.reconcile.cron',
    pattern: '0 3 * * *',
    tz: DEFAULT_SYNC_TZ
  }
] as const;

export type RegisteredSchedule = {
  schedulerId: string;
  queueName: SyncScheduleQueueName;
  pattern: string;
  tz: string;
};

export type GetQueueFn = (name: QueueName) => Queue;

export async function registerSyncSchedules(
  getQueueFn: GetQueueFn = getQueue
): Promise<RegisteredSchedule[]> {
  const results: RegisteredSchedule[] = [];
  const registeredAt = new Date().toISOString();
  for (const schedule of SYNC_SCHEDULES) {
    const queue = getQueueFn(schedule.queueName);
    const payload: SyncJobPayload = {
      triggeredAt: registeredAt,
      reason: 'cron'
    };
    await queue.upsertJobScheduler(
      schedule.schedulerId,
      { pattern: schedule.pattern, tz: schedule.tz },
      { data: payload }
    );
    results.push({
      schedulerId: schedule.schedulerId,
      queueName: schedule.queueName,
      pattern: schedule.pattern,
      tz: schedule.tz
    });
  }
  return results;
}
