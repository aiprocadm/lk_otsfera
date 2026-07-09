import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { writeSyncLog, type SyncLogEntity } from '@/lib/services/oneCSync/log';
import { log } from '@/lib/logging';

const TRACKED_ENTITIES: ReadonlyArray<Extract<SyncLogEntity, 'order' | 'payment' | 'document' | 'organization'>> = [
  'organization',
  'order',
  'payment',
  'document'
];

const RECONCILE_WINDOW_MS = 25 * 60 * 60 * 1000;

export type SyncReconcileResult = {
  checkedAt: string;
  freshEntities: SyncLogEntity[];
  staleEntities: SyncLogEntity[];
  status: 'success' | 'warn';
};

export async function syncReconcileProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncReconcileResult> {
  const startedAt = Date.now();
  log.info('[worker] sync-reconcile job started', { id: job.id });

  const since = new Date(Date.now() - RECONCILE_WINDOW_MS);
  const fresh: SyncLogEntity[] = [];
  const stale: SyncLogEntity[] = [];

  for (const entity of TRACKED_ENTITIES) {
    const hit = await db.syncLog.findFirst({
      where: {
        entity,
        direction: 'inbound',
        status: 'success',
        createdAt: { gte: since }
      },
      select: { id: true }
    });
    if (hit) fresh.push(entity);
    else stale.push(entity);
  }

  const status: 'success' | 'warn' = stale.length === 0 ? 'success' : 'warn';
  const checkedAt = new Date().toISOString();
  const payload =
    status === 'success'
      ? { checkedAt }
      : { checkedAt, missing: stale };

  await writeSyncLog(
    {
      entity: 'reconcile',
      direction: 'inbound',
      operation: 'check',
      status,
      payload,
      durationMs: Date.now() - startedAt
    },
    db
  );

  return {
    checkedAt,
    freshEntities: fresh,
    staleEntities: stale,
    status
  };
}
