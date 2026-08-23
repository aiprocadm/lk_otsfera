import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { mayImportOneC } from '@/lib/auth/managerPolicy';
import { importScope } from '@/lib/services/oneCSync/scope';
import { normalizeInn, isValidInn } from '@/lib/services/oneCSync/inn';
import { counterpartyKey } from './counterparty-key';
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
  /** Ключ контрагента (`У-83`) — единица группировки, ИНН может отсутствовать. */
  key: string;
  name: string;
  inn: string | null;
  /** Сколько ещё строк очереди принадлежит этому же контрагенту. */
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
    select: {
      id: true,
      counterpartyName: true,
      counterpartyInn: true,
      counterpartyKey: true,
    },
  });

  // `У-89`: группируем по ключу контрагента, а не по ИНН — иначе строки без
  // ИНН (в карточке счёта 51 это большинство) снова выпали бы из пакетного
  // создания. ИНН остаётся атрибутом кандидата и может отсутствовать.
  const byKey = new Map<string, QueueOrgCandidate>();
  for (const row of rows) {
    const inn = normalizeInn(row.counterpartyInn ?? '');
    const validInn = isValidInn(inn) ? inn : null;
    const key = row.counterpartyKey ?? counterpartyKey(row.counterpartyName ?? '').key;
    // Ни названия, ни ИНН — создавать нечего.
    if (!key && !validInn) continue;
    // ИНН надёжнее названия: строки одного ИНН схлопываем по нему, даже если
    // в части строк имя потерялось. Без ИНН группа — ключ названия.
    const groupKey = validInn ? `inn:${validInn}` : key;
    const seen = byKey.get(groupKey);
    if (seen) {
      seen.alsoRows += 1;
      if (!seen.name && row.counterpartyName) seen.name = row.counterpartyName.trim();
      if (!seen.key && key) seen.key = key;
      continue;
    }
    byKey.set(groupKey, {
      rowId: row.id,
      key,
      name: row.counterpartyName?.trim() ?? '',
      inn: validInn,
      alsoRows: 0,
    });
  }
  if (byKey.size === 0) return { ok: true, candidates: [] };

  // Организация уже есть (по ИНН или по ключу названия в компании) — дубль не
  // заводим, строки привязывает оператор кнопкой «Привязать».
  const innList = [...byKey.values()].map((c) => c.inn).filter((x): x is string => !!x);
  const keyList = [...byKey.values()].map((c) => c.key).filter((k) => k.length > 0);
  const existing = await prisma.organization.findMany({
    where: {
      OR: [
        ...(innList.length ? [{ inn: { in: innList } }] : []),
        ...(keyList.length
          ? [
              {
                nameKey: { in: keyList },
                ...(scope.kind === 'company' ? { companyId: scope.companyId } : {}),
              },
            ]
          : []),
      ],
    },
    select: { inn: true, nameKey: true },
  });
  for (const org of existing) {
    for (const [groupKey, candidate] of byKey) {
      if ((org.inn && org.inn === candidate.inn) || (org.nameKey && org.nameKey === candidate.key)) {
        byKey.delete(groupKey);
      }
    }
  }

  return {
    ok: true,
    candidates: [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
  };
}

export type BulkCreateResult = {
  created: number;
  bound: number;
  /** `label` — ИНН, а у контрагента без него (`У-89`) название. */
  failed: Array<{ label: string; error: string }>;
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
      inn: candidate.inn ?? '',
      ...(args.companyId ? { companyId: args.companyId } : {}),
    });
    if (!created.ok) {
      result.failed.push({ label: candidate.inn ?? candidate.name, error: created.error });
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
        select: { id: true, counterpartyInn: true, counterpartyKey: true },
      });
      // Сравниваем нормализованные ИНН: в очереди лежит то, что было в файле
      // (с пробелами и апострофами), а кандидат уже нормализован. У контрагента
      // без ИНН (`У-89`) роль общего признака играет ключ названия.
      const rest = raw.filter((r) =>
        candidate.inn
          ? normalizeInn(r.counterpartyInn ?? '') === candidate.inn
          : !!candidate.key && r.counterpartyKey === candidate.key
      );
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
