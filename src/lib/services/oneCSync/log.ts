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
  | 'commission';

export type SyncLogEntry = {
  entity: SyncLogEntity;
  externalId?: string;
  direction: 'inbound' | 'outbound';
  operation: 'create' | 'update' | 'skip' | 'delete' | 'check';
  status: 'success' | 'error' | 'warn';
  errorMessage?: string;
  payload?: unknown;
  durationMs?: number;
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
      durationMs: entry.durationMs ?? null
    }
  });
}
