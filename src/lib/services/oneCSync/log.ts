import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/db/prisma';

export type SyncLogEntity =
  | 'order'
  | 'payment'
  | 'document'
  | 'organization'
  | 'lead'
  | 'reconcile'
  | 'scan'
  | 'commission'
  | 'inbound'
  | 'call';

export type SyncLogEntry = {
  entity: SyncLogEntity;
  externalId?: string | undefined;
  direction: 'inbound' | 'outbound';
  operation: 'create' | 'update' | 'skip' | 'delete' | 'check' | 'import';
  status: 'success' | 'error' | 'warn';
  errorMessage?: string | undefined;
  payload?: unknown;
  durationMs?: number | undefined;
};

export async function writeSyncLog(
  entry: SyncLogEntry,
  db: PrismaClient = defaultPrisma
): Promise<void> {
  await db.syncLog.create({
    data: {
      entity: entry.entity,
      externalId: entry.externalId ?? null,
      direction: entry.direction,
      operation: entry.operation,
      status: entry.status,
      errorMessage: entry.errorMessage ?? null,
      payload: (entry.payload as object) ?? undefined,
      durationMs: entry.durationMs ?? null,
    },
  });
}
