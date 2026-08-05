import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { FileOneCAdapter } from '@/lib/services/oneCSync/adapter-file';
import { OneCOrderSchema, OneCPaymentSchema } from '@/lib/services/oneCSync/schemas';
import { runRecordBatch, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import {
  upsertOrderRecord,
  upsertPaymentRecord,
  type WriteCtx,
} from '@/lib/services/oneCSync/writers';
import { importScope } from '@/lib/services/oneCSync/scope';
import { recordAudit } from '@/lib/auth/audit';
import type { OneCOrderDto, OneCPaymentDto } from '@/lib/services/oneCSync/dto';
import type { ImportDiagnostics } from '@/lib/services/import/diagnostics';
import { sniffWorkbookFormat, WorkbookFormatError } from '@/lib/services/import/workbook';
import { log } from '@/lib/logging';

type Args = {
  fileBuffer: Buffer;
  /** Имя файла — только для замечания о расхождении расширения и содержимого (Т-14). */
  fileName?: string;
};
type Err =
  | 'forbidden'
  | 'parse_failed'
  | 'format_mismatch'
  | 'sheets_not_recognized'
  | 'columns_not_recognized'
  | 'empty';
export type ImportReport = {
  orders: BatchSummary;
  payments: BatchSummary;
  /** Что система увидела в файле (Т-3) — показывается и при успехе, и при ошибке. */
  diagnostics: ImportDiagnostics;
};

/**
 * Отказ разбора. Диагностика прикладывается везде, где книгу удалось открыть:
 * блок «что увидела система» нужнее всего именно тогда, когда не распозналось
 * ничего. При `parse_failed`/`format_mismatch` её нет — книгу открыть не
 * удалось, причина в журнале или в самом коде ошибки.
 */
type Failure = { ok: false; error: Err; diagnostics?: ImportDiagnostics };

function isStaff(s: SessionPayload) {
  return s.role === 'admin' || s.role === 'manager';
}

/** Замечание для диагностики: имя файла говорит одно, содержимое — другое (Т-14). */
function formatNoteFor(buffer: Buffer, fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const format = sniffWorkbookFormat(buffer);
  if (!format || fileName.toLowerCase().endsWith(`.${format}`)) return undefined;
  return format === 'xls'
    ? `Файл называется «${fileName}», но внутри — старый формат .xls. Прочитан по содержимому; чтобы предупреждение исчезло, пересохраните из 1С в «Лист Excel 2007-…(xlsx)».`
    : `Файл называется «${fileName}», но внутри — формат .xlsx. Прочитан по содержимому.`;
}

function parseFailure(e: unknown): Failure {
  if (e instanceof WorkbookFormatError) {
    // Содержимое — не книга Excel (.mxl, PDF, мусор): это внятный отказ, а не сбой.
    return { ok: false, error: 'format_mismatch' };
  }
  log.error('[1c-import] не удалось разобрать файл', e);
  return { ok: false, error: 'parse_failed' };
}

/**
 * Общий каркас предпросмотра и импорта.
 *
 * Порядок принципиален (Т-11/Т-12): сначала книга разбирается и проверяется
 * распознавание листов и обязательных колонок, и только потом идут записи.
 * Иначе live-режим успел бы записать распознанную часть файла до того, как
 * выяснится, что другая половина не распозналась, — частичный импорт с
 * сообщением об ошибке хуже честного отказа. Книга при этом парсится один раз:
 * адаптер кэширует разбор.
 */
async function run(
  prisma: PrismaClient,
  session: SessionPayload,
  args: Args,
  mode: 'shadow' | 'live'
): Promise<{ ok: true; report: ImportReport } | Failure> {
  let adapter: FileOneCAdapter;
  let diagnostics: ImportDiagnostics;
  try {
    adapter = new FileOneCAdapter(args.fileBuffer);
    diagnostics = await adapter.diagnostics();
  } catch (e) {
    return parseFailure(e);
  }
  const formatNote = formatNoteFor(args.fileBuffer, args.fileName);
  if (formatNote) diagnostics.formatNote = formatNote;

  // Ключи unmatchedHeaders — фактические имена распознанных листов.
  if (Object.keys(diagnostics.unmatchedHeaders).length === 0) {
    return { ok: false, error: 'sheets_not_recognized', diagnostics };
  }
  if (Object.keys(diagnostics.missingColumns).length > 0) {
    return { ok: false, error: 'columns_not_recognized', diagnostics };
  }

  const ctx: WriteCtx = { mode, notify: false, scope: importScope(session) };
  let report: ImportReport;
  try {
    // Orders first so a same-file payment referencing a freshly-created order resolves in live mode; then payments.
    const ordersRaw = (await adapter.pullOrders({})) as unknown[];
    const orders = await runRecordBatch<OneCOrderDto>(
      ordersRaw,
      OneCOrderSchema,
      (d) => d.externalId,
      (d, s) => upsertOrderRecord(prisma, d, s, ctx)
    );
    const paymentsRaw = (await adapter.pullPayments({})) as unknown[];
    const payments = await runRecordBatch<OneCPaymentDto>(
      paymentsRaw,
      OneCPaymentSchema,
      (d) => d.externalId,
      (d, s) => upsertPaymentRecord(prisma, d, s, ctx)
    );
    report = { orders, payments, diagnostics };
  } catch (e) {
    return parseFailure(e);
  }
  return { ok: true, report };
}

export async function previewImport(
  prisma: PrismaClient,
  session: SessionPayload,
  args: Args
): Promise<{ ok: true; report: ImportReport } | Failure> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  const result = await run(prisma, session, args, 'shadow');
  if (!result.ok) return result;
  const { report } = result;
  if (report.orders.pulled + report.payments.pulled === 0) {
    return { ok: false, error: 'empty', diagnostics: report.diagnostics };
  }
  return { ok: true, report };
}

export async function commitImport(
  prisma: PrismaClient,
  session: SessionPayload,
  args: Args
): Promise<{ ok: true; report: ImportReport } | Failure> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  const result = await run(prisma, session, args, 'live');
  if (!result.ok) return result;
  const { report } = result;
  try {
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'one_c_import.commit',
      entity: 'one_c_import',
      entityId: session.companyId ?? session.sub,
      after: { orders: report.orders, payments: report.payments },
    });
  } catch (e) {
    log.error('one_c_import audit failed (non-blocking):', e);
  }
  return { ok: true, report };
}
