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
import { log } from '@/lib/logging';

type Args = { fileBuffer: Buffer };
type Err = 'forbidden' | 'parse_failed' | 'empty';
export type ImportReport = { orders: BatchSummary; payments: BatchSummary };

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
  return { orders, payments };
}

export async function previewImport(
  prisma: PrismaClient,
  session: SessionPayload,
  args: Args
): Promise<{ ok: true; report: ImportReport } | { ok: false; error: Err }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  let report: ImportReport;
  try {
    report = await run(prisma, session, args.fileBuffer, 'shadow');
  } catch {
    return { ok: false, error: 'parse_failed' };
  }
  if (report.orders.pulled + report.payments.pulled === 0) return { ok: false, error: 'empty' };
  return { ok: true, report };
}

export async function commitImport(
  prisma: PrismaClient,
  session: SessionPayload,
  args: Args
): Promise<{ ok: true; report: ImportReport } | { ok: false; error: Err }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  let report: ImportReport;
  try {
    report = await run(prisma, session, args.fileBuffer, 'live');
  } catch {
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
