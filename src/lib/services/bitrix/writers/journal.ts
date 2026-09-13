import type { Prisma } from '@prisma/client';
import type { BitrixEntity } from '../mapping/types';
import type { FieldMap } from '../idempotency';

/**
 * Журнал записей пакета (`У-196`): что именно миграция сделала с каждой
 * строкой. Пишется В ТОЙ ЖЕ транзакции, что и сама строка, и намеренно НЕ
 * fail-open — в отличие от журнала импорта 1С.
 *
 * Причина простая: журнал — единственный способ откатить перенос. Запись без
 * журнала значит «изменили и не знаем, как вернуть», а откат у этого этапа —
 * требование приёмки, а не удобство.
 */
export type WriteAction = 'created' | 'updated' | 'linked';

export type WriteOutcome = {
  entityId: string;
  action: WriteAction;
  /** Поля, которые оставили человеку (правило §3.4) — уедут в отчёт сверки. */
  keptManual: string[];
};

/** Транзакция строки: писателю не нужен весь клиент, только её. */
export type Tx = Prisma.TransactionClient;

export type ApplyContext = {
  batchId: string;
  companyId: string;
  /** Кто запустил пакет: автор создаваемых строк там, где автор обязателен. */
  importerId: string;
  /** Менеджер по умолчанию для несопоставленных ответственных. */
  defaultManagerId: string | null;
  /**
   * `after` последней записи журнала по строке. Из него правило «правленное
   * руками не перезаписываем» узнаёт, что записал прошлый прогон.
   */
  lastAfter: (entity: BitrixEntity, entityId: string) => FieldMap | null;
};

const asJson = (value: FieldMap): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function writeJournal(
  tx: Tx,
  ctx: ApplyContext,
  row: {
    entity: BitrixEntity;
    entityId: string;
    bitrixId: string;
    action: WriteAction;
    before?: FieldMap | undefined;
    after?: FieldMap | undefined;
  }
): Promise<void> {
  await tx.bitrixImportWrite.create({
    data: {
      batchId: ctx.batchId,
      entity: row.entity,
      entityId: row.entityId,
      bitrixId: row.bitrixId,
      action: row.action,
      ...(row.before && Object.keys(row.before).length > 0 ? { before: asJson(row.before) } : {}),
      ...(row.after && Object.keys(row.after).length > 0 ? { after: asJson(row.after) } : {}),
    },
  });
}

/**
 * Снимок созданной строки для журнала: по нему откат поймёт, что удалять, а
 * следующий прогон — что записал этот. Даты и суммы приводятся к простым
 * значениям: в `Json` Prisma объекты `Date` и `Decimal` не кладутся.
 */
export function snapshot(data: Record<string, unknown>): FieldMap {
  const out: FieldMap = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (value instanceof Date) out[key] = value.toISOString();
    else if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else out[key] = String(value);
  }
  return out;
}
