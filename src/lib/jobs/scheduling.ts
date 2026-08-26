import type { Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { getQueue, type QueueName } from './queues';
import type { SyncJobPayload } from './types';

type SyncScheduleQueueName = Extract<
  QueueName,
  | 'oneCSync.pullOrders'
  | 'oneCSync.pullPayments'
  | 'oneCSync.pullDocuments'
  | 'oneCSync.pullOrganizations'
  | 'oneCSync.reconcile'
  | 'inbound.email.poll'
  | 'telephony.mango.backfill'
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
    tz: DEFAULT_SYNC_TZ,
  },
  {
    queueName: 'oneCSync.pullPayments',
    schedulerId: 'oneCSync.pullPayments.cron',
    pattern: '*/15 * * * *',
    tz: DEFAULT_SYNC_TZ,
  },
  {
    queueName: 'oneCSync.pullDocuments',
    schedulerId: 'oneCSync.pullDocuments.cron',
    pattern: '0 * * * *',
    tz: DEFAULT_SYNC_TZ,
  },
  {
    queueName: 'oneCSync.pullOrganizations',
    schedulerId: 'oneCSync.pullOrganizations.cron',
    pattern: '0 */6 * * *',
    tz: DEFAULT_SYNC_TZ,
  },
  {
    queueName: 'oneCSync.reconcile',
    schedulerId: 'oneCSync.reconcile.cron',
    pattern: '0 3 * * *',
    tz: DEFAULT_SYNC_TZ,
  },
  {
    queueName: 'inbound.email.poll',
    schedulerId: 'inbound.email.poll.cron',
    pattern: '*/5 * * * *',
    tz: DEFAULT_SYNC_TZ,
  },
  {
    queueName: 'telephony.mango.backfill',
    schedulerId: 'telephony.mango.backfill.cron',
    pattern: '0 * * * *',
    tz: DEFAULT_SYNC_TZ,
  },
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
    tz: DEFAULT_SYNC_TZ,
  },
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
      tz: schedule.tz,
    });
  }
  return results;
}

/**
 * Регистрация расписаний обмена.
 *
 * `У-125`: паттерн берётся из `patterns` — их отдаёт `getSchedulePatterns`,
 * который накладывает заданное в интерфейсе поверх умолчаний из кода. Без
 * аргумента (тесты, вызов из скрипта) действуют умолчания — прежнее
 * поведение.
 */
export async function registerSyncSchedules(
  getQueueFn: GetQueueFn = getQueue,
  pausedSchedulerIds: ReadonlySet<string> = new Set(),
  patterns: ReadonlyMap<string, string> = new Map()
): Promise<RegisteredSchedule[]> {
  const results: RegisteredSchedule[] = [];
  const registeredAt = new Date().toISOString();
  for (const schedule of SYNC_SCHEDULES) {
    if (pausedSchedulerIds.has(schedule.schedulerId)) continue;
    const pattern = patterns.get(schedule.schedulerId) ?? schedule.pattern;
    const queue = getQueueFn(schedule.queueName);
    const payload: SyncJobPayload = {
      triggeredAt: registeredAt,
      reason: 'cron',
    };
    await queue.upsertJobScheduler(
      schedule.schedulerId,
      { pattern, tz: schedule.tz },
      { data: payload }
    );
    results.push({
      schedulerId: schedule.schedulerId,
      queueName: schedule.queueName,
      pattern,
      tz: schedule.tz,
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
    tz: DEFAULT_SYNC_TZ,
  },
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
      tz: schedule.tz,
    });
  }
  return results;
}

export type CalendarReminderSchedule = {
  queueName: Extract<QueueName, 'notifications.calendarReminder'>;
  schedulerId: string;
  pattern: string;
  tz: string;
};

// M5: напоминания о событиях календаря — каждые 5 минут (точечные напоминания
// о встречах; выборка узкая по индексу remindAt, спека 2026-07-17-m5-calendar §5).
export const CALENDAR_REMINDER_SCHEDULES: ReadonlyArray<CalendarReminderSchedule> = [
  {
    queueName: 'notifications.calendarReminder',
    schedulerId: 'notifications.calendarReminder.cron',
    pattern: '*/5 * * * *',
    tz: DEFAULT_SYNC_TZ,
  },
] as const;

export async function registerCalendarReminderSchedules(
  getQueueFn: GetQueueFn = getQueue
): Promise<Array<{ schedulerId: string; queueName: string; pattern: string; tz: string }>> {
  const results = [];
  const triggeredAt = new Date().toISOString();
  for (const schedule of CALENDAR_REMINDER_SCHEDULES) {
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
      tz: schedule.tz,
    });
  }
  return results;
}

export type TaskDueSoonSchedule = {
  queueName: Extract<QueueName, 'notifications.taskDueSoon'>;
  schedulerId: string;
  pattern: string;
  tz: string;
};

// Этап 7 (ФТ-7.2): «скоро срок задачи» — раз в день утром (как CertExpiry).
// Дедуп — Task.dueSoonNotifiedAt (атомарный claim в процессоре).
export const TASK_DUE_SOON_SCHEDULES: ReadonlyArray<TaskDueSoonSchedule> = [
  {
    queueName: 'notifications.taskDueSoon',
    schedulerId: 'notifications.taskDueSoon.cron',
    pattern: '0 7 * * *',
    tz: DEFAULT_SYNC_TZ,
  },
] as const;

export async function registerTaskDueSoonSchedules(
  getQueueFn: GetQueueFn = getQueue
): Promise<Array<{ schedulerId: string; queueName: string; pattern: string; tz: string }>> {
  const results = [];
  const triggeredAt = new Date().toISOString();
  for (const schedule of TASK_DUE_SOON_SCHEDULES) {
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
      tz: schedule.tz,
    });
  }
  return results;
}

export type SlaEscalationSchedule = {
  queueName: Extract<QueueName, 'monitoring.slaEscalation'>;
  schedulerId: string;
  pattern: string;
  tz: string;
};

// Этап 7 (ФТ-8.5, PR-3): SLA-эскалация Intake — каждые 30 минут (дедуп —
// журнал SlaEscalation, поэтому частота влияет только на задержку).
export const SLA_ESCALATION_SCHEDULES: ReadonlyArray<SlaEscalationSchedule> = [
  {
    queueName: 'monitoring.slaEscalation',
    schedulerId: 'monitoring.slaEscalation.cron',
    pattern: '*/30 * * * *',
    tz: DEFAULT_SYNC_TZ,
  },
] as const;

export async function registerSlaEscalationSchedules(
  getQueueFn: GetQueueFn = getQueue
): Promise<Array<{ schedulerId: string; queueName: string; pattern: string; tz: string }>> {
  const results = [];
  const triggeredAt = new Date().toISOString();
  for (const schedule of SLA_ESCALATION_SCHEDULES) {
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
      tz: schedule.tz,
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
    tz: DEFAULT_SYNC_TZ,
  },
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
      schedulerId: schedule.schedulerId,
      queueName: schedule.queueName,
      pattern: schedule.pattern,
      tz: schedule.tz,
    });
  }
  return results;
}

/**
 * Все расписания платформы одним списком — «id задачи → паттерн и пояс»
 * (`У-125`).
 *
 * До этого экран «Автообмен» держал СВОЮ копию паттернов (`cronLabel` в
 * `syncControl.ts`) «только для UI», и её приходилось стеречь отдельным
 * drift-тестом. Копия удалена: и воркер, и экран смотрят сюда.
 *
 * Правятся из интерфейса пока только `SYNC_SCHEDULES` (это объём `У-125`);
 * остальные показываются на чтение — у них своя очередь требований.
 */
export const ALL_SCHEDULES: ReadonlyArray<{
  schedulerId: string;
  pattern: string;
  tz: string;
  /** Можно ли задать расписание из интерфейса. */
  editable: boolean;
}> = [
  ...SYNC_SCHEDULES.map((s) => ({ ...s, editable: true })),
  ...COMMISSION_SCHEDULES.map((s) => ({ ...s, editable: false })),
  ...ALERT_SCHEDULES.map((s) => ({ ...s, editable: false })),
  ...CALENDAR_REMINDER_SCHEDULES.map((s) => ({ ...s, editable: false })),
  ...TASK_DUE_SOON_SCHEDULES.map((s) => ({ ...s, editable: false })),
  ...SLA_ESCALATION_SCHEDULES.map((s) => ({ ...s, editable: false })),
  ...CERT_EXPIRY_SCHEDULES.map((s) => ({ ...s, editable: false })),
].map(({ schedulerId, pattern, tz, editable }) => ({ schedulerId, pattern, tz, editable }));

/** Паттерн по умолчанию для задачи; `null` — такой задачи в реестрах нет. */
export function defaultPatternFor(schedulerId: string): string | null {
  return ALL_SCHEDULES.find((s) => s.schedulerId === schedulerId)?.pattern ?? null;
}
