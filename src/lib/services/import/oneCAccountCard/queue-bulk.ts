import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { mayImportOneC } from '@/lib/auth/managerPolicy';
import { importScope } from '@/lib/services/oneCSync/scope';
import { normalizeInn, isValidInn } from '@/lib/services/oneCSync/inn';
import { createOrgFromQueueRow } from './create-org';
import { resolveQueueRow } from './resolve-queue';

/**
 * Пакетное создание организаций из очереди разбора (`У-53`).
 *
 * Нужно для накопленного: строк с валидным ИНН в очереди могут быть сотни, и
 * заводить их по одной — та самая ручная работа, ради устранения которой
 * затевался этап. Действие **двухшаговое** (решение `Р-10`): сначала список
 * того, что будет создано, потом подтверждение; строку можно снять галочкой —
 * поэтому шаг подтверждения принимает список id, а не «создать всё».
 *
 * Ничего своего не пишет: создание — готовый `createOrgFromQueueRow`
 * (он же считает компанию по `У-50` и привязывает платёж), привязка
 * остальных строк того же ИНН — штатный `resolveQueueRow`. Иначе появился бы
 * второй путь создания организации со своими правилами.
 */
export type QueueOrgCandidate = {
  /** Строка, по которой будет создана организация. */
  rowId: string;
  name: string;
  inn: string;
  /** Сколько ещё строк очереди принадлежит этому же ИНН. */
  alsoRows: number;
};

/** Первый шаг (`Р-10`): что именно будет создано. Ничего не пишет. */
export async function planQueueOrgCreation(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<
  { ok: true; candidates: QueueOrgCandidate[] } | { ok: false; error: 'forbidden' | 'not_allowed' }
> {
  if (!mayImportOneC(session)) return { ok: false, error: 'forbidden' };
  const scope = importScope(session);
  // Обычный менеджер организаций не заводит — ни по одной, ни пачкой.
  if (scope.kind === 'orgs') return { ok: false, error: 'not_allowed' };

  const rows = await prisma.paymentImportRow.findMany({
    where: {
      status: 'needs_review',
      ...(scope.kind === 'company' ? { batch: { companyId: scope.companyId } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, counterpartyName: true, counterpartyInn: true },
  });

  const byInn = new Map<string, QueueOrgCandidate>();
  for (const row of rows) {
    const inn = normalizeInn(row.counterpartyInn ?? '');
    if (!isValidInn(inn)) continue;
    const seen = byInn.get(inn);
    if (seen) {
      seen.alsoRows += 1;
      if (!seen.name && row.counterpartyName) seen.name = row.counterpartyName.trim();
      continue;
    }
    byInn.set(inn, {
      rowId: row.id,
      name: row.counterpartyName?.trim() ?? '',
      inn,
      alsoRows: 0,
    });
  }
  if (byInn.size === 0) return { ok: true, candidates: [] };

  // Организации с такими ИНН уже есть — их создавать нельзя (`У-49`), строки
  // привязывает оператор кнопкой «Привязать».
  const existing = await prisma.organization.findMany({
    where: { inn: { in: [...byInn.keys()] } },
    select: { inn: true },
  });
  for (const org of existing) {
    if (org.inn) byInn.delete(org.inn);
  }

  return {
    ok: true,
    candidates: [...byInn.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
  };
}

export type BulkCreateResult = {
  created: number;
  bound: number;
  failed: Array<{ inn: string; error: string }>;
};

/**
 * Второй шаг: создать организации по выбранным строкам.
 *
 * `rowIds` — строки из показанного списка (снятые галочки просто не приходят).
 * Список пересчитывается заново: между показом и подтверждением организацию
 * могли завести вручную, и повторное создание дало бы дубль.
 */
export async function createOrgsFromQueueRows(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { rowIds: string[]; companyId?: string | undefined }
): Promise<
  { ok: true; result: BulkCreateResult } | { ok: false; error: 'forbidden' | 'not_allowed' }
> {
  const planned = await planQueueOrgCreation(prisma, session);
  if (!planned.ok) return planned;

  const chosen = planned.candidates.filter((c) => args.rowIds.includes(c.rowId));
  const result: BulkCreateResult = { created: 0, bound: 0, failed: [] };

  for (const candidate of chosen) {
    const created = await createOrgFromQueueRow(prisma, session, {
      rowId: candidate.rowId,
      name: candidate.name || `Организация по ИНН ${candidate.inn}`,
      inn: candidate.inn,
      ...(args.companyId ? { companyId: args.companyId } : {}),
    });
    if (!created.ok) {
      result.failed.push({ inn: candidate.inn, error: created.error });
      continue;
    }
    result.created += 1;

    // Остальные строки того же контрагента привязываем к созданной
    // организации — иначе человек получил бы организацию и всё равно ручную
    // работу по её же платежам.
    if (candidate.alsoRows > 0) {
      const scope = importScope(session);
      const raw = await prisma.paymentImportRow.findMany({
        where: {
          status: 'needs_review',
          ...(scope.kind === 'company' ? { batch: { companyId: scope.companyId } } : {}),
        },
        select: { id: true, counterpartyInn: true },
      });
      // Сравниваем нормализованные ИНН: в очереди лежит то, что было в файле
      // (с пробелами и апострофами), а кандидат уже нормализован.
      const rest = raw.filter((r) => normalizeInn(r.counterpartyInn ?? '') === candidate.inn);
      for (const row of rest) {
        const bound = await resolveQueueRow(prisma, session, {
          rowId: row.id,
          organizationId: created.organizationId,
          orderId: null,
        });
        if (bound.ok) result.bound += 1;
      }
    }
  }
  return { ok: true, result };
}
