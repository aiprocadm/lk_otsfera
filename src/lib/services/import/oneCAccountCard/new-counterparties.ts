import type { PrismaClient } from '@prisma/client';
import { normalizeInn, isValidInn } from '@/lib/services/oneCSync/inn';

/**
 * Контрагенты из выписки, которых в системе ещё нет (`У-52`).
 *
 * Предпросмотр обязан показать это ДО применения: человеку нужно понимать, что
 * принесёт файл, а не узнавать об этом по факту. Тот же список станет списком
 * автосоздания в PR-3 (`У-49`), поэтому условие здесь ровно то, что требует
 * ТЗ: ИНН проходит проверку контрольной суммы **и** организации с таким ИНН
 * ещё нет.
 *
 * Считаем только по строкам, ушедшим в очередь разбора: строка, привязавшаяся
 * к заказу или организации, по определению уже нашла своего клиента —
 * заводить ему дубль было бы вредом, а не пользой.
 */
export type NewCounterparty = {
  name: string;
  inn: string;
  /** Сколько строк файла принадлежит этому контрагенту. */
  rows: number;
};

type QueuedRow = { counterpartyName: string | null; counterpartyInn: string | null };

export async function collectNewCounterparties(
  db: PrismaClient,
  queued: QueuedRow[]
): Promise<NewCounterparty[]> {
  const byInn = new Map<string, NewCounterparty>();
  for (const row of queued) {
    const inn = normalizeInn(row.counterpartyInn ?? '');
    if (!isValidInn(inn)) continue;
    const seen = byInn.get(inn);
    if (seen) {
      seen.rows += 1;
      // Имя берём первое непустое: в выписке оно иногда теряется в части строк.
      if (!seen.name && row.counterpartyName) seen.name = row.counterpartyName.trim();
      continue;
    }
    byInn.set(inn, { name: row.counterpartyName?.trim() ?? '', inn, rows: 1 });
  }
  if (byInn.size === 0) return [];

  const existing = await db.organization.findMany({
    where: { inn: { in: [...byInn.keys()] } },
    select: { inn: true },
  });
  for (const org of existing) {
    if (org.inn) byInn.delete(org.inn);
  }

  return [...byInn.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
