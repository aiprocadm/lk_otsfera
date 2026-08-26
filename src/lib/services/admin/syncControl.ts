import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import { getQueue, type QueueName } from '@/lib/jobs/queues';
import { recordAudit } from '@/lib/auth/audit';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { SYNC_SCHEDULES } from '@/lib/jobs/scheduling';
import { log } from '@/lib/logging';

export type SyncControlEntity =
  | 'organization'
  | 'order'
  | 'payment'
  | 'document'
  | 'reconcile'
  | 'certificateExpiry'
  | 'emailPoll'
  | 'mangoBackfill'
  | 'monthlyCommissions';

// `У-125`: поля `cronLabel` здесь БОЛЬШЕ НЕТ. Оно дублировало паттерн из
// `scheduling.ts` «только для UI» — два источника правды, которые держал
// отдельный drift-тест. Теперь расписание одно и берётся из
// `getSchedulePatterns` (умолчание из кода + правка из интерфейса).
export const SYNC_ENTITIES: Record<
  SyncControlEntity,
  { queueName: QueueName; schedulerId: string; hasCursor: boolean }
> = {
  organization: {
    queueName: 'oneCSync.pullOrganizations',
    schedulerId: 'oneCSync.pullOrganizations.cron',
    hasCursor: true,
  },
  order: {
    queueName: 'oneCSync.pullOrders',
    schedulerId: 'oneCSync.pullOrders.cron',
    hasCursor: true,
  },
  payment: {
    queueName: 'oneCSync.pullPayments',
    schedulerId: 'oneCSync.pullPayments.cron',
    hasCursor: true,
  },
  document: {
    queueName: 'oneCSync.pullDocuments',
    schedulerId: 'oneCSync.pullDocuments.cron',
    hasCursor: true,
  },
  reconcile: {
    queueName: 'oneCSync.reconcile',
    schedulerId: 'oneCSync.reconcile.cron',
    hasCursor: false,
  },
  // G3: run-now для standalone cron-джобов. Паузой управляет SYNC_SCHEDULES
  // (setSchedulePaused ищет по schedulerId в нём, не в этом реестре), поэтому
  // certificateExpiry/monthlyCommissions паузе не подлежат by design; их
  // процессоры игнорируют payload — manual-джоба {triggeredAt, reason} безопасна.
  certificateExpiry: {
    queueName: 'notifications.certificateExpiry',
    schedulerId: 'notifications.certificateExpiry.cron',
    hasCursor: false,
  },
  emailPoll: {
    queueName: 'inbound.email.poll',
    schedulerId: 'inbound.email.poll.cron',
    hasCursor: false,
  },
  mangoBackfill: {
    queueName: 'telephony.mango.backfill',
    schedulerId: 'telephony.mango.backfill.cron',
    hasCursor: false,
  },
  monthlyCommissions: {
    queueName: 'docs.calculateMonthlyCommissions',
    schedulerId: 'docs.calculateMonthlyCommissions.cron',
    hasCursor: false,
  },
};

function isSyncControlEntity(x: string): x is SyncControlEntity {
  return Object.prototype.hasOwnProperty.call(SYNC_ENTITIES, x);
}

/** Injection seam: trigger needs add/getJobCounts, pause needs scheduler ops. */
export type SyncControlQueueProvider = (
  name: QueueName
) => Pick<Queue, 'getJobCounts' | 'add' | 'upsertJobScheduler' | 'removeJobScheduler'>;

/* v8 ignore next 1 — default provider is only used in production/integration; unit tests always inject a mock provider */
const defaultSyncProvider: SyncControlQueueProvider = (name) => getQueue(name);

export type RewindResult =
  | { ok: true; entity: SyncControlEntity; cursor: string | null }
  | { ok: false; error: 'unknown_entity' | 'invalid_cursor' | 'storage' };

export async function rewindCursor(
  prisma: PrismaClient,
  actorUserId: string,
  entity: string,
  cursorIso: string | null
): Promise<RewindResult> {
  if (!isSyncControlEntity(entity) || !SYNC_ENTITIES[entity].hasCursor) {
    return { ok: false, error: 'unknown_entity' };
  }
  if (cursorIso !== null) {
    const ts = Date.parse(cursorIso);
    if (Number.isNaN(ts) || ts > Date.now()) return { ok: false, error: 'invalid_cursor' };
  }
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.syncState.findUnique({
        where: { entity },
        select: { cursor: true },
      });
      const before = existing?.cursor ?? null;
      await tx.syncState.upsert({
        where: { entity },
        update: { cursor: cursorIso },
        create: { entity, cursor: cursorIso },
      });
      await recordAudit(tx, {
        userId: actorUserId,
        action: 'cursor_rewound',
        entity: 'sync_state',
        entityId: entity,
        before: { cursor: before },
        after: { cursor: cursorIso },
      });
    });
    return { ok: true, entity, cursor: cursorIso };
  } catch {
    return { ok: false, error: 'storage' };
  }
}

export type TriggerResult =
  | { ok: true; jobId: string }
  | { ok: false; error: 'already_running' | 'queue_unavailable' | 'unknown_entity' };

export async function triggerSync(
  prisma: PrismaClient,
  actorUserId: string,
  entity: string,
  provider: SyncControlQueueProvider = defaultSyncProvider
): Promise<TriggerResult> {
  if (!isSyncControlEntity(entity)) return { ok: false, error: 'unknown_entity' };
  const { queueName } = SYNC_ENTITIES[entity];
  let jobId: string;
  try {
    const queue = provider(queueName);
    const counts = (await queue.getJobCounts('active')) as { active?: number };
    if ((counts.active ?? 0) > 0) return { ok: false, error: 'already_running' };
    jobId = `manual:${entity}:${Date.now()}`;
    const payload: SyncJobPayload = { triggeredAt: new Date().toISOString(), reason: 'manual' };
    await queue.add('manual', payload, { jobId });
  } catch {
    return { ok: false, error: 'queue_unavailable' };
  }
  // Audit is a secondary effect — never fail the enqueue over it (§3 graceful degrade).
  await recordAudit(prisma, {
    userId: actorUserId,
    action: 'sync_triggered',
    entity: 'sync_state',
    entityId: entity,
    after: { jobId, queue: queueName },
  }).catch((e) => log.warn('[syncControl] trigger audit failed', e));
  return { ok: true, jobId };
}

export type PauseResult =
  { ok: true; paused: boolean } | { ok: false; error: 'queue_unavailable' | 'unknown_schedule' };

export async function setSchedulePaused(
  prisma: PrismaClient,
  actorUserId: string,
  schedulerId: string,
  paused: boolean,
  provider: SyncControlQueueProvider = defaultSyncProvider
): Promise<PauseResult> {
  const schedule = SYNC_SCHEDULES.find((s) => s.schedulerId === schedulerId);
  if (!schedule) return { ok: false, error: 'unknown_schedule' };

  // DB is the source of truth (worker reconciles on next register) — write it first.
  if (paused) {
    await prisma.syncSchedulePause.upsert({
      where: { schedulerId },
      update: { pausedBy: actorUserId, pausedAt: new Date() },
      create: { schedulerId, pausedBy: actorUserId },
    });
  } else {
    await prisma.syncSchedulePause.deleteMany({ where: { schedulerId } });
  }

  // Apply to the live Redis scheduler immediately.
  try {
    const queue = provider(schedule.queueName);
    if (paused) {
      await queue.removeJobScheduler(schedulerId);
    } else {
      await queue.upsertJobScheduler(
        schedulerId,
        { pattern: schedule.pattern, tz: schedule.tz },
        { data: { triggeredAt: new Date().toISOString(), reason: 'cron' } }
      );
    }
  } catch {
    // DB already reflects intent; surface so the operator can retry.
    return { ok: false, error: 'queue_unavailable' };
  }

  await recordAudit(prisma, {
    userId: actorUserId,
    action: paused ? 'sync_schedule_paused' : 'sync_schedule_resumed',
    entity: 'sync_schedule',
    entityId: schedulerId,
  }).catch((e) => log.warn('[syncControl] pause audit failed', e));
  return { ok: true, paused };
}
