import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { upsertPaymentRecord, type WriteCtx } from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';
import { importScope } from '@/lib/services/oneCSync/scope';
import { recordAudit } from '@/lib/auth/audit';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getObjectStorage } from '@/lib/storage';
import { log } from '@/lib/logging';
import { readSpreadsheet } from './read-spreadsheet';
import { parseAccountCard } from './parser';
import { matchRow } from './matcher';
import type { ParsedRow, CardImportCounts } from './types';

export type PaymentImportError = 'invalid_file' | 'forbidden' | 'empty' | 'parse_failed';
export type Args = { fileBuffer: Buffer; fileName: string };

function isStaff(s: SessionPayload) { return s.role === 'admin' || s.role === 'manager'; }
function emptyCounts(): CardImportCounts {
  return { totalRows: 0, imported: 0, refunds: 0, queued: 0, excluded: 0, excludedByReason: {}, parseErrors: 0 };
}

type Routed = { row: ParsedRow; outcome: Awaited<ReturnType<typeof matchRow>> };

/** Разбор файла + матчинг каждой импортируемой строки. Чистая фаза (read-only). */
async function plan(prisma: PrismaClient, buffer: Buffer, fileName: string): Promise<{ counts: CardImportCounts; routed: Routed[] }> {
  const grid = await readSpreadsheet(buffer, fileName);
  const rows = parseAccountCard(grid);
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
    if (row.parseError) { counts.parseErrors += 1; continue; }
    const outcome = await matchRow(prisma, row);
    if (outcome.route === 'exact') { counts.imported += 1; if (row.isRefund) counts.refunds += 1; }
    else counts.queued += 1;
    routed.push({ row, outcome });
  }
  return { counts, routed };
}

export async function previewPaymentImport(prisma: PrismaClient, session: SessionPayload, args: Args) {
  if (!isStaff(session)) return { ok: false as const, error: 'forbidden' as const };
  let result: Awaited<ReturnType<typeof plan>>;
  try { result = await plan(prisma, args.fileBuffer, args.fileName); }
  catch { return { ok: false as const, error: 'parse_failed' as const }; }
  if (result.counts.totalRows === 0) return { ok: false as const, error: 'empty' as const };
  return { ok: true as const, plan: { counts: result.counts } };
}

export async function commitPaymentImport(prisma: PrismaClient, session: SessionPayload, args: Args) {
  if (!isStaff(session)) return { ok: false as const, error: 'forbidden' as const };
  let result: Awaited<ReturnType<typeof plan>>;
  try { result = await plan(prisma, args.fileBuffer, args.fileName); }
  catch { return { ok: false as const, error: 'parse_failed' as const }; }
  if (result.counts.totalRows === 0) return { ok: false as const, error: 'empty' as const };

  const ctx: WriteCtx = { mode: 'live', notify: true, scope: importScope(session) };
  const writerSummary = emptySummary();

  const batchId = await prisma.$transaction(async (tx) => {
    const batch = await tx.paymentImportBatch.create({
      data: { importedById: session.sub, companyId: session.companyId ?? null, fileName: args.fileName, counts: result.counts as unknown as Prisma.InputJsonValue, status: 'committed' },
    });
    for (const { row, outcome } of result.routed) {
      if (outcome.route === 'exact') {
        await upsertPaymentRecord(tx as unknown as PrismaClient, outcome.dto, writerSummary, ctx);
        // если строка ранее была в очереди — закрыть её
        await tx.paymentImportRow.updateMany({ where: { externalId: row.externalId, status: 'needs_review' }, data: { status: 'resolved' } });
      } else {
        await tx.paymentImportRow.upsert({
          where: { externalId: row.externalId },
          create: {
            batchId: batch.id, externalId: row.externalId, paidAt: new Date(row.paidAt as string), amount: row.amount as number,
            isRefund: row.isRefund, purpose: row.purpose, paymentOrderNumber: row.paymentOrderNumber, vatAmount: row.vatAmount,
            counterpartyName: row.counterpartyName, counterpartyInn: row.counterpartyInn,
            accountCandidates: row.accountCandidates as unknown as Prisma.InputJsonValue, status: 'needs_review',
            candidateOrgId: outcome.candidateOrgId, candidateOrderId: outcome.candidateOrderId, matchMethod: outcome.matchMethod,
            rawRow: row.rawRow as unknown as Prisma.InputJsonValue,
          },
          update: {
            // обновляем только ещё не разобранные строки (не реанимируем resolved/dismissed)
            paidAt: new Date(row.paidAt as string), amount: row.amount as number, purpose: row.purpose, paymentOrderNumber: row.paymentOrderNumber, vatAmount: row.vatAmount,
            counterpartyName: row.counterpartyName, counterpartyInn: row.counterpartyInn,
            accountCandidates: row.accountCandidates as unknown as Prisma.InputJsonValue,
            candidateOrgId: outcome.candidateOrgId, candidateOrderId: outcome.candidateOrderId, matchMethod: outcome.matchMethod,
          },
        });
      }
    }
    return batch.id;
  });

  // Файл в S3 (best-effort, не блокирует уже применённый импорт)
  const fileKey = `payments-import/${batchId}/${randomUUID()}-${args.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  try {
    await getObjectStorage().upload(fileKey, args.fileBuffer, { contentType: 'application/octet-stream' });
    await prisma.paymentImportBatch.update({ where: { id: batchId }, data: { fileKey } });
  } catch (e) { log.warn('[card51] file store failed (non-blocking):', e instanceof Error ? e.message : e); }

  // Журнал (best-effort)
  try {
    await writeSyncLog({ entity: 'payment', direction: 'inbound', operation: 'import', status: result.counts.parseErrors > 0 ? 'warn' : 'success', payload: { fileName: args.fileName, ...result.counts } }, prisma);
  } catch (e) { log.warn('[card51] syncLog failed (non-blocking):', e); }
  try {
    await recordAudit(prisma, { userId: session.sub, action: 'payment_import.commit', entity: 'payment', entityId: batchId, after: { fileName: args.fileName, ...result.counts } });
  } catch (e) { log.warn('[card51] audit failed (non-blocking):', e); }

  return { ok: true as const, result: { counts: result.counts, batchId } };
}
