import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  getBitrixBatch,
  listBitrixBatches,
  type BitrixBatchFail,
  type BitrixBatchView,
} from './preview';
import { rollbackStateOf, ROLLBACK_STATE_HINTS, type RollbackState } from './rollback';

/**
 * История пакетов миграции (`У-198`).
 *
 * Список отличается от карточки одним: у каждой строки посчитано, можно ли её
 * откатить и почему нельзя. Считается это по тем же данным, по которым потом
 * пойдёт сам откат — статусу пакета, дате применения и числу неоткаченных
 * строк журнала. Разъехаться подпись кнопки и поведение не могут.
 */
export type BitrixHistoryItem = BitrixBatchView & {
  rollback: RollbackState;
  /** Почему кнопка неактивна; у `available` — пустая строка. */
  rollbackHint: string;
};

/**
 * Больше не показываем: история переносов — не бесконечная лента.
 *
 * **Предел отдаётся наружу вместе с общим числом** (`limit`, `total`): экран
 * обязан сказать «показаны последние N из M», иначе администратор не отличит
 * «это вся история» от «видна только верхушка» — а идёт он сюда именно за
 * старыми переносами. Молчаливо усечённый список — дефект (§15/§16).
 */
const HISTORY_LIMIT = 50;

export async function listBitrixHistory(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<
  { ok: true; batches: BitrixHistoryItem[]; total: number; limit: number } | BitrixBatchFail
> {
  const list = await listBitrixBatches(prisma, session, HISTORY_LIMIT);
  if (!list.ok) return list;
  if (list.batches.length === 0)
    return { ok: true, batches: [], total: list.total, limit: HISTORY_LIMIT };

  // Неоткаченные строки — одним запросом на всю страницу: иначе список из
  // пятидесяти пакетов дал бы пятьдесят запросов.
  const pending = await prisma.bitrixImportWrite.groupBy({
    by: ['batchId'],
    where: { batchId: { in: list.batches.map((b) => b.id) }, reverted: false },
    _count: { _all: true },
  });
  const pendingByBatch = new Map(pending.map((p) => [p.batchId, p._count._all]));

  const now = Date.now();
  return {
    ok: true,
    total: list.total,
    limit: HISTORY_LIMIT,
    batches: list.batches.map((batch) => {
      const state = rollbackStateOf(batch, now, pendingByBatch.get(batch.id) ?? 0);
      return { ...batch, rollback: state, rollbackHint: ROLLBACK_STATE_HINTS[state] };
    }),
  };
}

/** То же состояние отката для карточки одного пакета. */
export async function getBitrixBatchWithRollback(
  prisma: PrismaClient,
  session: SessionPayload,
  batchId: string
): Promise<{ ok: true; batch: BitrixHistoryItem } | BitrixBatchFail> {
  const found = await getBitrixBatch(prisma, session, batchId);
  if (!found.ok) return found;
  const pending = await prisma.bitrixImportWrite.count({ where: { batchId, reverted: false } });
  const state = rollbackStateOf(found.batch, Date.now(), pending);
  return {
    ok: true,
    batch: { ...found.batch, rollback: state, rollbackHint: ROLLBACK_STATE_HINTS[state] },
  };
}
