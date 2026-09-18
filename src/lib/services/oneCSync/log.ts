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
  | 'call'
  // `У-256`: контакты контрагента, приехавшие из 1С.
  | 'contact'
  // `У-257`: сверка дебиторки — свой канал истории обмена.
  | 'debt';

export type SyncLogEntry = {
  entity: SyncLogEntity;
  externalId?: string | undefined;
  direction: 'inbound' | 'outbound';
  operation:
    | 'create'
    | 'update'
    | 'skip'
    | 'delete'
    | 'check'
    | 'import'
    | 'export'
    // `У-257`: сверка дебиторки — отдельная операция, чтобы в истории обмена
    // её строки отделялись от проверки «обмен вообще живой».
    | 'reconcile';
  status: 'success' | 'error' | 'warn';
  errorMessage?: string | undefined;
  payload?: unknown;
  durationMs?: number | undefined;
};

/**
 * Возвращает id записи: файловый пакет для 1С (`У-173`) ссылается на неё из
 * журнала аудита — пакет один, а документов в нём до пятисот. Без `select`
 * намеренно: форму вызова `create({ data })` проверяют тесты процессоров.
 */
export async function writeSyncLog(
  entry: SyncLogEntry,
  db: PrismaClient = defaultPrisma
): Promise<{ id: string }> {
  const row = await db.syncLog.create({
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
  return { id: row.id };
}
