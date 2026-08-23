import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { upsertPaymentRecord, type WriteCtx } from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';
import { importScope } from '@/lib/services/oneCSync/scope';
import { mayImportOneC } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getObjectStorage } from '@/lib/storage';
import { log } from '@/lib/logging';
import { normalizeInn } from '@/lib/services/oneCSync/inn';
import { readSpreadsheet } from './read-spreadsheet';
import { parseAccountCard } from './parser';
import { organizationNameKey } from './counterparty-key';
import { matchRow } from './matcher';
import { collectNewCounterparties, type CounterpartyOverride } from './new-counterparties';
import { resolveNewOrgCompany, createOrganizationsForImport } from './auto-create';
import type { ParsedRow, CardImportCounts, CardParseDiagnostics } from './types';

export type Args = {
  fileBuffer: Buffer;
  fileName: string;
  /** Компания для новых организаций (`У-50`): нужна администратору. */
  companyId?: string | undefined;
  /**
   * Правки предпросмотра (`У-87`): снятые галочки и вписанные вручную ИНН.
   * Состояние предпросмотра на сервере не хранится (файл пересчитывается
   * заново), поэтому решения человека едут вместе с применением — по ключу
   * контрагента, а не по номеру строки.
   */
  overrides?: CounterpartyOverride[] | undefined;
};

// Т-25/Т-26: право импорта — admin и руководитель (mayImportOneC), общий
// предикат с Excel-импортом. Прежний локальный isStaff() удалён.
function emptyCounts(): CardImportCounts {
  return {
    totalRows: 0,
    imported: 0,
    refunds: 0,
    queued: 0,
    excluded: 0,
    excludedByReason: {},
    queuedByReason: {},
    parseErrors: 0,
    orgsCreated: 0,
  };
}

type Routed = { row: ParsedRow; outcome: Awaited<ReturnType<typeof matchRow>> };

/**
 * Пересчёт «к импорту / в очередь» по итоговым маршрутам строк.
 *
 * Именно пересчёт, а не правка счётчиков по месту: после автосоздания
 * организаций (`У-49`) часть строк переезжает из очереди в импортированные, и
 * инкременты пришлось бы «откручивать назад» — источник тихих расхождений.
 * Причина очереди нужна человеку: «в очередь: 130» без объяснения выглядит как
 * отказ импорта, хотя строки на самом деле разобраны.
 */
function countRoutes(counts: CardImportCounts, routed: Routed[]) {
  counts.imported = 0;
  counts.refunds = 0;
  counts.queued = 0;
  counts.queuedByReason = {};
  for (const { row, outcome } of routed) {
    if (outcome.route === 'exact') {
      counts.imported += 1;
      if (row.isRefund) counts.refunds += 1;
    } else {
      counts.queued += 1;
      const reason = outcome.matchMethod;
      counts.queuedByReason[reason] = (counts.queuedByReason[reason] ?? 0) + 1;
    }
  }
}

/**
 * Компания, в скоупе которой матчим строку по ключу названия (`У-88`).
 * Руководитель — своя (C8, выбор формы игнорируется); рядовой менеджер — своя
 * (организаций он не заводит, но матчить в своей компании безопасно); админ —
 * выбранная в форме. Без компании ступень пропускается: матч по названию «во
 * всех компаниях» ломал бы изоляцию.
 */
function matchScopeCompanyId(session: SessionPayload, formCompanyId?: string): string | null {
  const scope = importScope(session);
  if (scope.kind === 'company') return scope.companyId;
  if (scope.kind === 'orgs') return session.companyId ?? null;
  return formCompanyId ?? null;
}

/**
 * Сводка по контрагентам файла (`У-92`). Фраза «создано 3 организации» обязана
 * сопровождаться ответом «а остальные — почему нет»: сколько контрагентов
 * увидели, у скольких ИНН из файла, скольким его нашёл ЕГРЮЛ, сколько
 * останется без ИНН, сколько уже есть в системе и сколько будет создано.
 */
function counterpartySummary(c: Awaited<ReturnType<typeof collectNewCounterparties>>) {
  return {
    total: c.total,
    innFromFile: c.candidates.filter((x) => x.innSource === 'file').length,
    innFromDadata: c.candidates.filter((x) => x.innSource === 'dadata').length,
    withoutInn: c.candidates.filter((x) => !x.inn).length,
    alreadyKnown: c.existing.length,
    willCreate: c.candidates.length,
    reasons: c.reasons,
    dadataUsed: c.dadata.used,
    ...(c.dadata.reason ? { dadataReason: c.dadata.reason } : {}),
  };
}

/** Разбор файла + матчинг каждой импортируемой строки. Чистая фаза (read-only). */
async function plan(
  prisma: PrismaClient,
  buffer: Buffer,
  fileName: string,
  matchCompanyId: string | null
): Promise<{ counts: CardImportCounts; routed: Routed[]; diagnostics: CardParseDiagnostics }> {
  const grid = await readSpreadsheet(buffer, fileName);
  const { rows, diagnostics } = parseAccountCard(grid);
  const counts = emptyCounts();
  counts.totalRows = rows.length;
  const routed: Routed[] = [];

  for (const row of rows) {
    if (row.kind === 'excluded') {
      counts.excluded += 1;
      // classifyRow always sets excludeReason for kind:'excluded' rows, so the
      // `?? 'corr_other'` fallback is an unreachable defensive default.
      /* v8 ignore next */
      const reason = row.excludeReason ?? 'corr_other';
      counts.excludedByReason[reason] = (counts.excludedByReason[reason] ?? 0) + 1;
      continue;
    }
    if (row.parseError) {
      counts.parseErrors += 1;
      continue;
    }
    const outcome = await matchRow(prisma, row, { companyId: matchCompanyId });
    routed.push({ row, outcome });
  }
  countRoutes(counts, routed);
  return { counts, routed, diagnostics };
}

export async function previewPaymentImport(
  prisma: PrismaClient,
  session: SessionPayload,
  args: Args
) {
  if (!mayImportOneC(session)) return { ok: false as const, error: 'forbidden' as const };
  let result: Awaited<ReturnType<typeof plan>>;
  try {
    result = await plan(
      prisma,
      args.fileBuffer,
      args.fileName,
      matchScopeCompanyId(session, args.companyId)
    );
  } catch {
    return { ok: false as const, error: 'parse_failed' as const };
  }
  // `У-57`/`У-58`: пустой разбор больше не «просто empty» — вместе с кодом
  // ошибки отдаём то, что система увидела в файле, иначе человеку нечего чинить.
  if (result.counts.totalRows === 0) {
    return {
      ok: false as const,
      error: 'empty' as const,
      diagnostics: result.diagnostics,
    };
  }
  // `У-52`: что принесёт файл, человек должен увидеть ДО применения.
  const collected = await collectNewCounterparties(
    prisma,
    result.routed.filter((r) => r.outcome.route === 'queue').map((r) => r.row),
    {
      companyId: matchScopeCompanyId(session, args.companyId),
      ...(args.overrides ? { overrides: args.overrides } : {}),
    }
  );
  return {
    ok: true as const,
    plan: {
      counts: result.counts,
      diagnostics: result.diagnostics,
      newCounterparties: collected.candidates,
      counterparties: counterpartySummary(collected),
    },
  };
}

export async function commitPaymentImport(
  prisma: PrismaClient,
  session: SessionPayload,
  args: Args
) {
  if (!mayImportOneC(session)) return { ok: false as const, error: 'forbidden' as const };
  let result: Awaited<ReturnType<typeof plan>>;
  try {
    result = await plan(
      prisma,
      args.fileBuffer,
      args.fileName,
      matchScopeCompanyId(session, args.companyId)
    );
  } catch {
    return { ok: false as const, error: 'parse_failed' as const };
  }
  if (result.counts.totalRows === 0) {
    return { ok: false as const, error: 'empty' as const, diagnostics: result.diagnostics };
  }

  // `У-49`: организации, которых нет в системе, заводим сами — но СНАЧАЛА
  // проверяем, куда их класть (`У-50`). Отказать нужно ДО записи чего-либо,
  // иначе половина файла уже применена.
  const collected = await collectNewCounterparties(
    prisma,
    result.routed.filter((r) => r.outcome.route === 'queue').map((r) => r.row),
    {
      companyId: matchScopeCompanyId(session, args.companyId),
      ...(args.overrides ? { overrides: args.overrides } : {}),
    }
  );
  // `У-87`: негодный ИНН, вписанный руками, — отказ ДО записи, а не молчаливое
  // «создали без ИНН»: человек ждёт, что его цифра поедет в карточку.
  if (collected.badOverrides.length > 0) {
    return { ok: false as const, error: 'bad_inn' as const };
  }
  const company = resolveNewOrgCompany(session, args.companyId);
  if (!company.ok && company.error === 'company_required' && collected.candidates.length > 0) {
    return { ok: false as const, error: 'company_required' as const };
  }
  // `not_allowed` (обычный менеджер) — не отказ импорта: его строки просто
  // уходят в очередь ручного разбора, как и раньше (`У-51`).
  const creating = company.ok ? collected.candidates : [];

  const ctx: WriteCtx = { mode: 'live', notify: true, scope: importScope(session) };
  const writerSummary = emptySummary();

  const batchId = await prisma.$transaction(async (tx) => {
    const batch = await tx.paymentImportBatch.create({
      data: {
        importedById: session.sub,
        companyId: session.companyId ?? null,
        fileName: args.fileName,
        counts: result.counts as unknown as Prisma.InputJsonValue,
        status: 'committed',
      },
    });
    // Организации создаются ДО записи платежей: матчер найдёт их по ИНН сам,
    // и отдельной ветки «привязать вручную» не появляется.
    const created = company.ok
      ? await createOrganizationsForImport(tx, session, {
          candidates: creating,
          companyId: company.companyId,
          batchId: batch.id,
          fileName: args.fileName,
        })
      : { byInn: new Map<string, string>(), byKey: new Map<string, string>() };
    result.counts.orgsCreated = creating.length;

    // Итоговые маршруты: после автосоздания часть строк уходит из очереди.
    const finalRoutes: Routed[] = [];

    for (const { row, outcome: initial } of result.routed) {
      let outcome = initial;
      // Строка ушла бы в очередь только потому, что организации не было —
      // теперь она есть, и матчер привяжет платёж: по ИНН, а у организации,
      // заведённой по названию (`У-86`), — по ключу контрагента.
      const rowKey = organizationNameKey(row.counterpartyName ?? '');
      const justCreated =
        created.byInn.has(normalizeInn(row.counterpartyInn ?? '')) ||
        (!!rowKey && created.byKey.has(rowKey));
      if (outcome.route === 'queue' && justCreated) {
        outcome = await matchRow(tx as unknown as PrismaClient, row, {
          companyId: matchScopeCompanyId(session, args.companyId),
        });
      }
      finalRoutes.push({ row, outcome });

      if (outcome.route === 'exact') {
        const written = await upsertPaymentRecord(
          tx as unknown as PrismaClient,
          outcome.dto,
          writerSummary,
          ctx
        );
        // `У-59`: след записи — фундамент отката. Без него откатывать нечего:
        // именно поэтому у выписки отката не было, хотя writer снимок «до»
        // отдавал всегда. `undefined` = writer строку пропустил (не в скоупе,
        // заказ не найден) — записывать в след нечего.
        if (written) {
          await tx.paymentImportWrite.create({
            data: {
              batchId: batch.id,
              entity: 'payment',
              entityId: written.entityId,
              action: written.action,
              ...(written.before ? { before: written.before as Prisma.InputJsonValue } : {}),
            },
          });
        }
        // если строка ранее была в очереди — закрыть её
        await tx.paymentImportRow.updateMany({
          where: { externalId: row.externalId, status: 'needs_review' },
          data: { status: 'resolved' },
        });
      } else {
        await tx.paymentImportRow.upsert({
          where: { externalId: row.externalId },
          create: {
            batchId: batch.id,
            externalId: row.externalId,
            paidAt: new Date(row.paidAt as string),
            amount: row.amount as number,
            isRefund: row.isRefund,
            purpose: row.purpose,
            paymentOrderNumber: row.paymentOrderNumber,
            vatAmount: row.vatAmount,
            counterpartyName: row.counterpartyName,
            counterpartyInn: row.counterpartyInn,
            // `У-83`: ключ контрагента — группировка очереди и привязка
            // «все строки того же ключа».
            counterpartyKey: organizationNameKey(row.counterpartyName ?? ''),
            accountCandidates: row.accountCandidates as unknown as Prisma.InputJsonValue,
            status: 'needs_review',
            candidateOrgId: outcome.candidateOrgId,
            candidateOrderId: outcome.candidateOrderId,
            matchMethod: outcome.matchMethod,
            rawRow: row.rawRow as unknown as Prisma.InputJsonValue,
          },
          update: {
            // обновляем только ещё не разобранные строки (не реанимируем resolved/dismissed)
            paidAt: new Date(row.paidAt as string),
            amount: row.amount as number,
            purpose: row.purpose,
            paymentOrderNumber: row.paymentOrderNumber,
            vatAmount: row.vatAmount,
            counterpartyName: row.counterpartyName,
            counterpartyInn: row.counterpartyInn,
            counterpartyKey: organizationNameKey(row.counterpartyName ?? ''),
            accountCandidates: row.accountCandidates as unknown as Prisma.InputJsonValue,
            candidateOrgId: outcome.candidateOrgId,
            candidateOrderId: outcome.candidateOrderId,
            matchMethod: outcome.matchMethod,
          },
        });
      }
    }
    countRoutes(result.counts, finalRoutes);
    // Счётчики после автосоздания уже другие (часть строк ушла из очереди),
    // а батч создавался раньше — записываем итог, иначе история соврёт.
    await tx.paymentImportBatch.update({
      where: { id: batch.id },
      data: { counts: result.counts as unknown as Prisma.InputJsonValue },
    });
    return batch.id;
  });

  // Файл в S3 (best-effort, не блокирует уже применённый импорт)
  const fileKey = `payments-import/${batchId}/${randomUUID()}-${args.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  try {
    await getObjectStorage().upload(fileKey, args.fileBuffer, {
      contentType: 'application/octet-stream',
    });
    await prisma.paymentImportBatch.update({ where: { id: batchId }, data: { fileKey } });
  } catch (e) {
    log.warn('[card51] file store failed (non-blocking):', e instanceof Error ? e.message : e);
  }

  // Журнал (best-effort)
  try {
    await writeSyncLog(
      {
        entity: 'payment',
        direction: 'inbound',
        operation: 'import',
        status: result.counts.parseErrors > 0 ? 'warn' : 'success',
        payload: { fileName: args.fileName, ...result.counts },
      },
      prisma
    );
  } catch (e) {
    log.warn('[card51] syncLog failed (non-blocking):', e);
  }
  try {
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'payment_import.commit',
      entity: 'payment',
      entityId: batchId,
      after: { fileName: args.fileName, ...result.counts },
    });
  } catch (e) {
    log.warn('[card51] audit failed (non-blocking):', e);
  }

  return {
    ok: true as const,
    result: { counts: result.counts, batchId, diagnostics: result.diagnostics },
  };
}
