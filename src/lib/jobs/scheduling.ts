import type { Queue } from 'bullmq';
import { getQueue, type QueueName } from './queues';
import type { SyncJobPayload } from './types';
import type { PrismaClient } from '@prisma/client';

export type SyncScheduleQueueName = Extract<
  QueueName,
  | 'oneCSync.pullOrders'
  | 'oneCSync.pullPayments'
  | 'oneCSync.pullDocuments'
  | 'oneCSync.pullOrganizations'
  | 'oneCSync.reconcile'
  | 'inbound.email.poll'
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
  },
  {
    queueName: 'inbound.email.poll',
    schedulerId: 'inbound.email.poll.cron',
    pattern: '*/5 * * * *',
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

export type CommissionSchedule = {
  queueName: Extract<QueueName, 'docs.calculateMonthlyCommissions'>;
  schedulerId: string;
  pattern: string;
  tz: string;
};

export const COMMISSION_SCHEDULES: ReadonlyArray<CommissionSchedule> = [
  {
    queueName: 'docs.calculateMonthlyCommissions',
    schedulerId: 'docs.calculateMonthlyCommissions.cron',
    pattern: '0 6 1 * *',
    tz: DEFAULT_SYNC_TZ
  }
] as const;

export async function registerCommissionSchedules(
  getQueueFn: GetQueueFn = getQueue
): Promise<Array<{ schedulerId: string; queueName: string; pattern: string; tz: string }>> {
  const results = [];
  const triggeredAt = new Date().toISOString();
  for (const schedule of COMMISSION_SCHEDULES) {
    const queue = getQueueFn(schedule.queueName);
    await queue.upsertJobScheduler(
      schedule.schedulerId,
      { pattern: schedule.pattern, tz: schedule.tz },
      { data: { triggeredAt, reason: 'cron' } }
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

export async function registerSyncSchedules(
  getQueueFn: GetQueueFn = getQueue,
  pausedSchedulerIds: ReadonlySet<string> = new Set(),
): Promise<RegisteredSchedule[]> {
  const results: RegisteredSchedule[] = [];
  const registeredAt = new Date().toISOString();
  for (const schedule of SYNC_SCHEDULES) {
    if (pausedSchedulerIds.has(schedule.schedulerId)) continue;
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

/** Reads the paused-schedule set so the worker can skip them at registration. */
export async function loadPausedSchedulerIds(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.syncSchedulePause.findMany({ select: { schedulerId: true } });
  return new Set(rows.map((r) => r.schedulerId));
}

export type AlertSchedule = {
  queueName: Extract<QueueName, 'monitoring.evaluateAlerts'>;
  schedulerId: string;
  pattern: string;
  tz: string;
};

export const ALERT_SCHEDULES: ReadonlyArray<AlertSchedule> = [
  {
    queueName: 'monitoring.evaluateAlerts',
    schedulerId: 'monitoring.evaluateAlerts.cron',
    pattern: '*/5 * * * *',
    tz: DEFAULT_SYNC_TZ
  }
] as const;

export async function registerAlertSchedules(
  getQueueFn: GetQueueFn = getQueue
): Promise<Array<{ schedulerId: string; queueName: string; pattern: string; tz: string }>> {
  const results = [];
  const triggeredAt = new Date().toISOString();
  for (const schedule of ALERT_SCHEDULES) {
    const queue = getQueueFn(schedule.queueName);
    await queue.upsertJobScheduler(
      schedule.schedulerId,
      { pattern: schedule.pattern, tz: schedule.tz },
      { data: { triggeredAt, reason: 'cron' } }
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

export type CertExpirySchedule = {
  queueName: Extract<QueueName, 'notifications.certificateExpiry'>;
  schedulerId: string;
  pattern: string;
  tz: string;
};

export const CERT_EXPIRY_SCHEDULES: ReadonlyArray<CertExpirySchedule> = [
  {
    queueName: 'notifications.certificateExpiry',
    schedulerId: 'notifications.certificateExpiry.cron',
    pattern: '0 7 * * *',
    tz: DEFAULT_SYNC_TZ
  }
] as const;

export async function registerCertExpirySchedules(
  getQueueFn: GetQueueFn = getQueue
): Promise<Array<{ schedulerId: string; queueName: string; pattern: string; tz: string }>> {
  const results = [];
  const triggeredAt = new Date().toISOString();
  for (const schedule of CERT_EXPIRY_SCHEDULES) {
    const queue = getQueueFn(schedule.queueName);
    await queue.upsertJobScheduler(
      schedule.schedulerId,
      { pattern: schedule.pattern, tz: schedule.tz },
      { data: { triggeredAt, reason: 'cron' } }
    );
    results.push({
      schedulerId: schedule.schedulerId, queueName: schedule.queueName,
      pattern: schedule.pattern, tz: schedule.tz
    });
  }
  return results;
}
