import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { OneCOrgSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCOrgDto } from '@/lib/services/oneCSync/dto';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';
import { upsertOrgRecord } from '@/lib/services/oneCSync/writers';
import { capturePendingSkips, replayPendingRecords } from '@/lib/services/oneCSync/pending';
import { log } from '@/lib/logging';

export type SyncOrganizationsResult = BatchSummary;

export async function syncOrganizationsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncOrganizationsResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  log.info('[worker] sync-organizations job started', { id: job.id, mode });

  try {
    // Конфиг адаптера 1С теперь в настройках интеграций — праймим кэш, чтобы
    // изменения из /admin/integrations доехали до воркера без рестарта.
    await primeIntegrationSettingsCache(db);
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'organization');
    const raw = (await adapter.pullOrganizations(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCOrgDto>(
      raw,
      OneCOrgSchema,
      (dto) => dto.externalId,
      (dto, sum) => upsertOrgRecord(db, dto, sum, { mode, notify: true, bump })
    );

    if (mode === 'live') await advanceCursor(db, 'organization', maxUpdatedAt);

    if (mode === 'live') {
      // Capture out-of-order skips and replay the backlog so nothing is lost when a
      // dependency (org/order) appears later. Best-effort: never fail the pull on this.
      try {
        await capturePendingSkips(db, 'organization', raw, (dto) => (dto as OneCOrgDto).externalId, summary);
        await replayPendingRecords(db, 'organization', { now: new Date() });
      } catch (e) {
        log.warn('[sync-organization] pending capture/replay failed', e);
      }
    }

    await writeSyncLog(
      {
        entity: 'organization',
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
    await markCursorError(db, 'organization', message).catch((e) =>
      log.warn('[sync-organizations] markCursorError failed', e)
    );
    await writeSyncLog(
      { entity: 'organization', direction: 'inbound', operation: 'skip', status: 'error', errorMessage: message, durationMs: Date.now() - startedAt },
      db
    );
    throw err;
  }
}
