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
 * Returns per-entity sync freshness: how long ago the last successful inbound
 * batch ran, plus 24h success/error counts. Reuses `getSyncSummary` so the
 * /admin/sync table and /admin/health page agree on the underlying numbers.
 */
export async function getSyncLag(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<SyncLagRow[]> {
  const summary = await getSyncSummary(prisma);
  return summary.map((row) => ({
    entity: row.entity,
    lastSuccessAt: row.lastSuccessAt,
    lagMs: row.lastSuccessAt ? now.getTime() - row.lastSuccessAt.getTime() : null,
    successCount24h: row.successCount24h,
    errorCount24h: row.errorCount24h,
  }));
}
