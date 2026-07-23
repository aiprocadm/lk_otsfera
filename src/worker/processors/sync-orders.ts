import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { OneCOrderSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCOrderDto } from '@/lib/services/oneCSync/dto';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';
import { upsertOrderRecord } from '@/lib/services/oneCSync/writers';
import { capturePendingSkips, replayPendingRecords } from '@/lib/services/oneCSync/pending';
import { log } from '@/lib/logging';

export type SyncOrdersResult = BatchSummary;

export async function syncOrdersProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncOrdersResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  log.info('[worker] sync-orders job started', { id: job.id, mode });

  try {
    // Конфиг адаптера 1С теперь в настройках интеграций — праймим кэш, чтобы
    // изменения из /admin/integrations доехали до воркера без рестарта.
    await primeIntegrationSettingsCache(db);
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'order');
    const raw = (await adapter.pullOrders(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCOrderDto>(raw, OneCOrderSchema, (d) => d.externalId,
      (dto, sum) => upsertOrderRecord(db, dto, sum, { mode, notify: true, bump }));

    if (mode === 'live') await advanceCursor(db, 'order', maxUpdatedAt);

    if (mode === 'live') {
      // Capture out-of-order skips and replay the backlog so nothing is lost when a
      // dependency (org/order) appears later. Best-effort: never fail the pull on this.
      try {
        await capturePendingSkips(db, 'order', raw, (dto) => (dto as OneCOrderDto).externalId, summary);
        await replayPendingRecords(db, 'order', { now: new Date() });
      } catch (e) {
        log.warn('[sync-order] pending capture/replay failed', e);
      }
    }

    await writeSyncLog(
      {
        entity: 'order',
        direction: 'inbound',
        operation: mode === 'shadow' ? 'check' : summary.created > 0 ? 'create' : 'update',
        status: batchStatus(summary),
        payload: { mode, ...summary },
        durationMs: Date.now() - startedAt
      },
      db
    );

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markCursorError(db, 'order', message).catch((e) =>
      log.warn('[sync-orders] markCursorError failed', e)
    );
    await writeSyncLog(
      {
        entity: 'order',
        direction: 'inbound',
        operation: 'skip',
        status: 'error',
        errorMessage: message,
        durationMs: Date.now() - startedAt
      },
      db
    );
    throw err;
  }
}
