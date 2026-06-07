import type { Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { getQueue, type QueueName } from '@/lib/jobs/queues';
import { recordAudit } from '@/lib/auth/audit';
import type { SyncJobPayload } from '@/lib/jobs/types';

export type SyncControlEntity = 'organization' | 'order' | 'payment' | 'document' | 'reconcile';

export const SYNC_ENTITIES: Record<
  SyncControlEntity,
  { queueName: QueueName; schedulerId: string; hasCursor: boolean }
> = {
  organization: { queueName: 'oneCSync.pullOrganizations', schedulerId: 'oneCSync.pullOrganizations.cron', hasCursor: true },
  order: { queueName: 'oneCSync.pullOrders', schedulerId: 'oneCSync.pullOrders.cron', hasCursor: true },
  payment: { queueName: 'oneCSync.pullPayments', schedulerId: 'oneCSync.pullPayments.cron', hasCursor: true },
  document: { queueName: 'oneCSync.pullDocuments', schedulerId: 'oneCSync.pullDocuments.cron', hasCursor: true },
  reconcile: { queueName: 'oneCSync.reconcile', schedulerId: 'oneCSync.reconcile.cron', hasCursor: false },
};

function isSyncControlEntity(x: string): x is SyncControlEntity {
  return Object.prototype.hasOwnProperty.call(SYNC_ENTITIES, x);
}

/** Injection seam: trigger needs add/getJobCounts, pause needs scheduler ops. */
export type SyncControlQueueProvider = (
  name: QueueName,
) => Pick<Queue, 'getJobCounts' | 'add' | 'upsertJobScheduler' | 'removeJobScheduler'>;

export const defaultSyncProvider: SyncControlQueueProvider = (name) => getQueue(name);

export type RewindResult =
  | { ok: true; entity: SyncControlEntity; cursor: string | null }
  | { ok: false; error: 'unknown_entity' | 'invalid_cursor' | 'storage' };

export async function rewindCursor(
  prisma: PrismaClient,
  actorUserId: string,
  entity: string,
  cursorIso: string | null,
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
      const existing = await tx.syncState.findUnique({ where: { entity }, select: { cursor: true } });
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
  provider: SyncControlQueueProvider = defaultSyncProvider,
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
  }).catch((e) => console.warn('[syncControl] trigger audit failed', e));
  return { ok: true, jobId };
}
