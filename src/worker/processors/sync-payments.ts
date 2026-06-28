import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { OneCPaymentSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCPaymentDto } from '@/lib/services/oneCSync/dto';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';
import { upsertPaymentRecord } from '@/lib/services/oneCSync/writers';

export type SyncPaymentsResult = BatchSummary;

export async function syncPaymentsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncPaymentsResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  console.log('[worker] sync-payments job started', { id: job.id, mode });

  try {
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'payment');
    const raw = (await adapter.pullPayments(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCPaymentDto>(
      raw,
      OneCPaymentSchema,
      (dto) => dto.externalId,
      (dto, sum) => upsertPaymentRecord(db, dto, sum, { mode, notify: true, bump })
    );

    if (mode === 'live') await advanceCursor(db, 'payment', maxUpdatedAt);

    await writeSyncLog(
      {
        entity: 'payment',
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
    await markCursorError(db, 'payment', message).catch((e) =>
      console.warn('[sync-payments] markCursorError failed', e)
    );
    await writeSyncLog(
      { entity: 'payment', direction: 'inbound', operation: 'skip', status: 'error', errorMessage: message, durationMs: Date.now() - startedAt },
      db
    );
    throw err;
  }
}
