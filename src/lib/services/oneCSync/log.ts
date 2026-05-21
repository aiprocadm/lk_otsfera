import { prisma } from '@/lib/db/prisma';

export type SyncLogEntry = {
  entity: 'order' | 'payment' | 'document' | 'organization' | 'lead';
  externalId?: string;
  direction: 'inbound' | 'outbound';
  operation: 'create' | 'update' | 'skip' | 'delete';
  status: 'success' | 'error' | 'warn';
  errorMessage?: string;
  payload?: unknown;
  durationMs?: number;
};

export async function writeSyncLog(entry: SyncLogEntry): Promise<void> {
  await prisma.syncLog.create({
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
