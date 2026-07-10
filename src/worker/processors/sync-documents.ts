import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { OneCDocumentSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCDocumentDto } from '@/lib/services/oneCSync/dto';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';
import { upsertDocumentRecord } from '@/lib/services/oneCSync/writers';
import { capturePendingSkips, replayPendingRecords } from '@/lib/services/oneCSync/pending';
import { log } from '@/lib/logging';

export type SyncDocumentsResult = BatchSummary;

export async function syncDocumentsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncDocumentsResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  log.info('[worker] sync-documents job started', { id: job.id, mode });

  try {
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'document');
    const raw = (await adapter.pullDocuments(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCDocumentDto>(
      raw,
      OneCDocumentSchema,
      (dto) => dto.externalId,
      (dto, sum) => upsertDocumentRecord(db, dto, sum, { mode, notify: true, bump })
    );

    if (mode === 'live') await advanceCursor(db, 'document', maxUpdatedAt);

    if (mode === 'live') {
      // Capture out-of-order skips and replay the backlog so nothing is lost when a
      // dependency (org/order) appears later. Best-effort: never fail the pull on this.
      try {
        await capturePendingSkips(db, 'document', raw, (dto) => (dto as OneCDocumentDto).externalId, summary);
        await replayPendingRecords(db, 'document', { now: new Date() });
      } catch (e) {
        log.warn('[sync-document] pending capture/replay failed', e);
      }
    }

    await writeSyncLog(
      {
        entity: 'document',
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
    await markCursorError(db, 'document', message).catch((e) =>
      log.warn('[sync-documents] markCursorError failed', e)
    );
    await writeSyncLog(
      { entity: 'document', direction: 'inbound', operation: 'skip', status: 'error', errorMessage: message, durationMs: Date.now() - startedAt },
      db
    );
    throw err;
  }
}
