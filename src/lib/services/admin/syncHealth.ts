import type { PrismaClient } from '@prisma/client';
import { getSyncSummary, type TrackedSyncEntity } from '@/lib/services/syncSummary';

export type SyncLagRow = {
  entity: TrackedSyncEntity;
  lastSuccessAt: Date | null;
  lagMs: number | null;
  successCount24h: number;
  errorCount24h: number;
};

/**
 * Returns per-entity sync freshness: how stale the persistent cursor watermark
 * is (spec §4.9), plus 24h success/error counts. Lag is measured from
 * `SyncState.cursor` — NOT from the last SyncLog success timestamp — so that
 * shadow/dry-run processors writing 'check' rows without advancing the cursor
 * are correctly flagged as stalled. `lastSuccessAt` is kept as a separate
 * display field. Reuses `getSyncSummary` so the /admin/sync table and
 * /admin/health page agree on the underlying numbers.
 */
export async function getSyncLag(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<SyncLagRow[]> {
  const summary = await getSyncSummary(prisma);
  return summary.map((row) => ({
    entity: row.entity,
    lastSuccessAt: row.lastSuccessAt,
    lagMs: row.cursor ? now.getTime() - Date.parse(row.cursor) : null,
    successCount24h: row.successCount24h,
    errorCount24h: row.errorCount24h,
  }));
}
