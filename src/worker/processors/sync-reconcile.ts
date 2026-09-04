import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { writeSyncLog, type SyncLogEntity } from '@/lib/services/oneCSync/log';
import {
  reconcilePushedDocuments,
  reconcileStuckLeads,
  type ReconcileDocumentsResult,
  type ReconcileLeadsResult,
} from '@/lib/services/oneCSync/reconcile';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { log } from '@/lib/logging';
import { notifyPushLeadFinalFailure } from './push-lead';

const TRACKED_ENTITIES: ReadonlyArray<
  Extract<SyncLogEntity, 'order' | 'payment' | 'document' | 'organization'>
> = ['organization', 'order', 'payment', 'document'];

const RECONCILE_WINDOW_MS = 25 * 60 * 60 * 1000;

export type SyncReconcileResult = {
  checkedAt: string;
  freshEntities: SyncLogEntity[];
  staleEntities: SyncLogEntity[];
  status: 'success' | 'warn';
  /** Этап 8 (`У-172`): итог сверки выгруженных документов с 1С. */
  documents: ReconcileDocumentsResult;
  /** Этап 8 (`У-172`, `Д-26`): итог по зависшим в отправке лидам. */
  leads: ReconcileLeadsResult;
};

/**
 * Ночная задача `oneCSync.reconcile` — три проверки подряд.
 *
 * 1. «Термометр»: по каждой входящей сущности был ли успешный обмен за
 *    25 часов. Отвечает на вопрос «обмен вообще живой?» — не удаляется.
 * 2. Сверка документов (`У-172`): всё, что в `pushed`, спрашивается у 1С;
 *    пропавшее → `failed` с причиной `missing_in_1c`.
 * 3. Зависшие лиды (`Д-26`): претензия старше суток без подтверждения —
 *    один повтор, второй раз — ошибка и уведомление партнёру.
 *
 * Проверки независимы: сбой второй не отменяет третью, итог каждой — своя
 * строка в истории обмена.
 */
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
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (hit) fresh.push(entity);
    else stale.push(entity);
  }

  const status: 'success' | 'warn' = stale.length === 0 ? 'success' : 'warn';
  const checkedAt = new Date().toISOString();
  const payload = status === 'success' ? { checkedAt } : { checkedAt, missing: stale };

  await writeSyncLog(
    {
      entity: 'reconcile',
      direction: 'inbound',
      operation: 'check',
      status,
      payload,
      durationMs: Date.now() - startedAt,
    },
    db
  );

  // Адаптер выбирается по настройкам из базы (`У-125`) — как у выгрузки.
  await primeIntegrationSettingsCache(db);
  const documents = await reconcilePushedDocuments(db);
  const leads = await reconcileStuckLeads(db);
  for (const leadId of leads.stuck) {
    // Уведомление — из воркера, как и при окончательном сбое очереди
    // (`worker/index.ts`): сервисы в `lib` про уведомления воркера не знают.
    await notifyPushLeadFinalFailure(db, {
      leadId,
      errorMessage: 'отправка зависла, повтор при сверке не помог',
    }).catch((e) => log.error('[worker] notifyPushLeadFinalFailure failed', e));
  }

  log.info('[worker] sync-reconcile job finished', {
    id: job.id,
    stale,
    documents: { checked: documents.checked, missing: documents.missing.length },
    leads: { requeued: leads.requeued.length, stuck: leads.stuck.length },
  });

  return {
    checkedAt,
    freshEntities: fresh,
    staleEntities: stale,
    status,
    documents,
    leads,
  };
}
