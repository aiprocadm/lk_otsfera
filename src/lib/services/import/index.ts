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
import { log } from '@/lib/logging';

type Args = { fileBuffer: Buffer };
type Err = 'forbidden' | 'parse_failed' | 'empty';
export type ImportReport = {
  orders: BatchSummary;
  payments: BatchSummary;
  /** Что система увидела в файле (Т-3) — показывается и при успехе, и при ошибке. */
  diagnostics: ImportDiagnostics;
};

/**
 * Отказ разбора. Диагностика прикладывается везде, где книгу удалось открыть:
 * блок «что увидела система» нужнее всего именно тогда, когда не распозналось
 * ничего. При `parse_failed` её нет — книгу открыть не удалось, причина ушла
 * в журнал.
 */
type Failure = { ok: false; error: Err; diagnostics?: ImportDiagnostics };

function isStaff(s: SessionPayload) {
  return s.role === 'admin' || s.role === 'manager';
}

async function run(
  prisma: PrismaClient,
  session: SessionPayload,
  buffer: Buffer,
  mode: 'shadow' | 'live'
): Promise<ImportReport> {
  const adapter = new FileOneCAdapter(buffer);
  const ctx: WriteCtx = { mode, notify: false, scope: importScope(session) };
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
  return { orders, payments, diagnostics: await adapter.diagnostics() };
}

export async function previewImport(
  prisma: PrismaClient,
  session: SessionPayload,
  args: Args
): Promise<{ ok: true; report: ImportReport } | Failure> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  let report: ImportReport;
  try {
    report = await run(prisma, session, args.fileBuffer, 'shadow');
  } catch (e) {
    log.error('[1c-import] не удалось разобрать файл', e);
    return { ok: false, error: 'parse_failed' };
  }
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
  let report: ImportReport;
  try {
    report = await run(prisma, session, args.fileBuffer, 'live');
  } catch (e) {
    log.error('[1c-import] не удалось разобрать файл', e);
    return { ok: false, error: 'parse_failed' };
  }
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
