import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';

/**
 * Админ-вьюер прикладного dead-letter 1С (модель OneCPendingRecord):
 * записи, отложенные live-sync'ом из-за отсутствия зависимости (организация/заказ).
 * Пишутся в capturePendingSkips, реплеятся в replayPendingRecords
 * (src/lib/services/oneCSync/pending.ts); здесь — только чтение и ручной
 * возврат dead-записей в очередь.
 */

/** Строка вьюера. Намеренно БЕЗ dto: там сырой DTO из 1С с ПДн — он не покидает сервис. */
export type PendingRecordRow = {
  id: string;
  entity: string;
  externalId: string;
  reason: string;
  attempts: number;
  status: string;
  firstSeenAt: Date;
  lastTriedAt: Date;
};

export type ListPendingRecordsResult =
  | { ok: true; records: PendingRecordRow[] }
  | { ok: false; error: 'forbidden' };

/**
 * Последние отложенные записи 1С для /admin/sync. Dead-записи первыми
 * ('dead' < 'pending' лексикографически при status asc), внутри статуса —
 * свежие попытки сверху; cap 100 строк (операторский обзор, не пагинация).
 */
export async function listPendingRecords(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<ListPendingRecordsResult> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };

  const records = await prisma.oneCPendingRecord.findMany({
    select: {
      id: true,
      entity: true,
      externalId: true,
      reason: true,
      attempts: true,
      status: true,
      firstSeenAt: true,
      lastTriedAt: true,
    },
    orderBy: [{ status: 'asc' }, { lastTriedAt: 'desc' }],
    take: 100,
  });

  return { ok: true, records };
}

export type RequeueDeadRecordResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'not_found' | 'not_dead' };

/**
 * Возвращает dead-запись в очередь replay: status → 'pending', attempts → 0
 * (счётчик к maxAttempts-бюджету начинается заново). Возвращённую запись
 * подберёт ближайший replayPendingRecords при live-sync — он читает
 * status:'pending' (src/lib/services/oneCSync/pending.ts).
 *
 * Age-бюджет НЕ сбрасывается: replay считает возраст от firstSeenAt, а requeue
 * его не трогает — запись старше maxAgeDays получит ровно одну попытку и снова
 * уйдёт в dead, если зависимость так и не появилась.
 *
 * CAS-паттерн: updateMany с {id, status:'dead'} в where — параллельный requeue
 * (или конкурентный replay, съевший запись) даёт count=0 → not_dead, без
 * второго аудита и без реанимации записи, изменившей статус между чтением и записью.
 */
export async function requeueDeadRecord(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<RequeueDeadRecordResult> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };

  const existing = await prisma.oneCPendingRecord.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };
  if (existing.status !== 'dead') return { ok: false, error: 'not_dead' };

  const updated = await prisma.oneCPendingRecord.updateMany({
    where: { id, status: 'dead' },
    data: { status: 'pending', attempts: 0 },
  });
  if (updated.count === 0) return { ok: false, error: 'not_dead' }; // проигрыш CAS-гонки

  // Аудит — вторичный эффект: запись уже возвращена, сбой журнала не откатывает её (§3 graceful).
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'one_c_pending_requeued',
    entity: 'one_c_pending',
    entityId: id,
    after: { status: 'pending', attempts: 0 },
  }).catch((e) => log.warn('[pendingRecords] requeue audit failed', e));

  return { ok: true };
}
