import type { PrismaClient } from '@prisma/client';

const TRACKED_ENTITIES = ['organization', 'order', 'payment', 'document'] as const;

export type TrackedSyncEntity = (typeof TRACKED_ENTITIES)[number];

export type SyncSummaryRow = {
  entity: TrackedSyncEntity;
  successCount24h: number;
  warnCount24h: number;
  errorCount24h: number;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
};

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function getSyncSummary(prisma: PrismaClient): Promise<SyncSummaryRow[]> {
  const since = new Date(Date.now() - WINDOW_MS);
  const rows: SyncSummaryRow[] = [];

  for (const entity of TRACKED_ENTITIES) {
    const [successCount24h, warnCount24h, errorCount24h, lastSuccess, lastError] = await Promise.all([
      prisma.syncLog.count({
        where: { entity, direction: 'inbound', status: 'success', createdAt: { gte: since } }
      }),
      prisma.syncLog.count({
        where: { entity, direction: 'inbound', status: 'warn', createdAt: { gte: since } }
      }),
      prisma.syncLog.count({
        where: { entity, direction: 'inbound', status: 'error', createdAt: { gte: since } }
      }),
      prisma.syncLog.findFirst({
        where: { entity, direction: 'inbound', status: 'success' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
      }),
      prisma.syncLog.findFirst({
        where: { entity, direction: 'inbound', status: 'error' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, errorMessage: true }
      })
    ]);

    rows.push({
      entity,
      successCount24h,
      warnCount24h,
      errorCount24h,
      lastSuccessAt: lastSuccess?.createdAt ?? null,
      lastErrorAt: lastError?.createdAt ?? null,
      lastErrorMessage: lastError?.errorMessage ?? null
    });
  }

  return rows;
}
