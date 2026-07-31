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
  cursor: string | null;
  lagMs: number | null;
};

/** Построчная ошибка синхронизации. Намеренно БЕЗ payload — см. listSyncErrors. */
export type SyncErrorRow = {
  id: string;
  entity: string;
  externalId: string | null;
  direction: string;
  operation: string;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: Date;
};

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function getSyncSummary(prisma: PrismaClient): Promise<SyncSummaryRow[]> {
  const since = new Date(Date.now() - WINDOW_MS);
  const rows: SyncSummaryRow[] = [];

  for (const entity of TRACKED_ENTITIES) {
    const [successCount24h, warnCount24h, errorCount24h, lastSuccess, lastError, state] =
      await Promise.all([
        prisma.syncLog.count({
          where: { entity, direction: 'inbound', status: 'success', createdAt: { gte: since } },
        }),
        prisma.syncLog.count({
          where: { entity, direction: 'inbound', status: 'warn', createdAt: { gte: since } },
        }),
        prisma.syncLog.count({
          where: { entity, direction: 'inbound', status: 'error', createdAt: { gte: since } },
        }),
        prisma.syncLog.findFirst({
          where: { entity, direction: 'inbound', status: 'success' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        prisma.syncLog.findFirst({
          where: { entity, direction: 'inbound', status: 'error' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, errorMessage: true },
        }),
        prisma.syncState.findUnique({ where: { entity }, select: { cursor: true } }),
      ]);

    const cursor = state?.cursor ?? null;
    const lagMs = cursor ? Date.now() - Date.parse(cursor) : null;

    rows.push({
      entity,
      successCount24h,
      warnCount24h,
      errorCount24h,
      lastSuccessAt: lastSuccess?.createdAt ?? null,
      lastErrorAt: lastError?.createdAt ?? null,
      lastErrorMessage: lastError?.errorMessage ?? null,
      cursor,
      lagMs,
    });
  }

  return rows;
}

/**
 * Последние 50 построчных ошибок синхронизации (SyncLog.status='error') для
 * /admin/health. `payload` НАМЕРЕННО не селектится: там сырой DTO из 1С,
 * который может содержать ПДн — он не покидает БД; полные записи смотреть
 * напрямую в SyncLog.
 */
export async function listSyncErrors(prisma: PrismaClient): Promise<SyncErrorRow[]> {
  return prisma.syncLog.findMany({
    where: { status: 'error' },
    select: {
      id: true,
      entity: true,
      externalId: true,
      direction: true,
      operation: true,
      errorMessage: true,
      durationMs: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}
