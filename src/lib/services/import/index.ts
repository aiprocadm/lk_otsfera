import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { FileOneCAdapter } from '@/lib/services/oneCSync/adapter-file';
import {
  OneCOrderSchema,
  OneCOrgFileSchema,
  OneCPaymentSchema,
} from '@/lib/services/oneCSync/schemas';
import { runRecordBatch, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import {
  upsertOrderRecord,
  upsertOrgRecord,
  upsertPaymentRecord,
  type WriteCtx,
} from '@/lib/services/oneCSync/writers';
import { importScope } from '@/lib/services/oneCSync/scope';
import { mayImportOneC } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import type { OneCOrderDto, OneCOrgDto, OneCPaymentDto } from '@/lib/services/oneCSync/dto';
import type { ImportDiagnostics } from '@/lib/services/import/diagnostics';
import { sniffWorkbookFormat, WorkbookFormatError } from '@/lib/services/import/workbook';
import { log } from '@/lib/logging';

type Args = {
  fileBuffer: Buffer;
  /** Имя файла — только для замечания о расхождении расширения и содержимого (Т-14). */
  fileName?: string;
  /**
   * Компания для НОВЫХ организаций (Т-41) — выбор admin'а из формы. Для
   * руководителя/менеджера игнорируется: их компанию задаёт скоуп сессии.
   */
  companyId?: string;
};
type Err =
  | 'forbidden'
  | 'parse_failed'
  | 'format_mismatch'
  | 'sheets_not_recognized'
  | 'columns_not_recognized'
  | 'company_required'
  | 'empty';
export type ImportReport = {
  orgs: BatchSummary;
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

// Т-25/Т-26: право импорта — admin и руководитель (mayImportOneC), обычный
// менеджер отбивается кодом forbidden. Прежний локальный isStaff() удалён.

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

  // Т-41: admin (Model A, своей компании нет) обязан назвать компанию для
  // НОВЫХ организаций. Передана → проверяем существование; не передана → при
  // единственной компании в системе берём её без вопроса (буква Т-41), иначе —
  // отказ ДО записей, одинаковый в предпросмотре и применении (план честный).
  // Руководителю/менеджеру компанию задаёт скоуп — параметр игнорируется.
  const scope = importScope(session);
  let createCompanyId: string | undefined;
  if (scope.kind === 'global') {
    if (args.companyId) {
      const company = await prisma.company.findUnique({
        where: { id: args.companyId },
        select: { id: true },
      });
      if (!company) return { ok: false, error: 'company_required', diagnostics };
      createCompanyId = company.id;
    } else {
      const companies = await prisma.company.findMany({ select: { id: true }, take: 2 });
      const only = companies.length === 1 ? companies[0] : undefined;
      if (!only) return { ok: false, error: 'company_required', diagnostics };
      createCompanyId = only.id;
    }
  }

  const ctx: WriteCtx = {
    mode,
    notify: false,
    scope,
    ...(createCompanyId ? { createCompanyId } : {}),
  };
  let report: ImportReport;
  try {
    // Т-17: организации ПЕРВЫМИ — заказ из того же файла находит свою
    // свежесозданную организацию в live-режиме; затем заказы, затем оплаты.
    // Файловая схема (Т-21) кладёт no_inn/bad_inn в таблицу ошибок, не роняя батч.
    const orgsRaw = (await adapter.pullOrganizations({})) as unknown[];
    const orgs = await runRecordBatch<OneCOrgDto>(
      orgsRaw,
      OneCOrgFileSchema,
      (d) => d.externalId,
      (d, s) => upsertOrgRecord(prisma, d, s, ctx)
    );
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
    report = { orgs, orders, payments, diagnostics };
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
  if (!mayImportOneC(session)) return { ok: false, error: 'forbidden' };
  const result = await run(prisma, session, args, 'shadow');
  if (!result.ok) return result;
  const { report } = result;
  if (report.orgs.pulled + report.orders.pulled + report.payments.pulled === 0) {
    return { ok: false, error: 'empty', diagnostics: report.diagnostics };
  }
  return { ok: true, report };
}

export async function commitImport(
  prisma: PrismaClient,
  session: SessionPayload,
  args: Args
): Promise<{ ok: true; report: ImportReport } | Failure> {
  if (!mayImportOneC(session)) return { ok: false, error: 'forbidden' };
  const result = await run(prisma, session, args, 'live');
  if (!result.ok) return result;
  const { report } = result;
  try {
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'one_c_import.commit',
      entity: 'one_c_import',
      entityId: session.companyId ?? session.sub,
      after: { orgs: report.orgs, orders: report.orders, payments: report.payments },
    });
  } catch (e) {
    log.error('one_c_import audit failed (non-blocking):', e);
  }
  return { ok: true, report };
}
