import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { parseWorkbook } from './parse-workbook';
import { validateRows } from './validate';
import { planImport } from './plan-import';
import { importScope } from './scope';
import { commitImport as commitTx } from './commit-import';
import type { ImportPlan } from './types';

type Args = { fileBuffer: Buffer };
type Err = 'invalid_file' | 'forbidden' | 'empty' | 'parse_failed';

function isStaff(s: SessionPayload) { return s.role === 'admin' || s.role === 'manager'; }

async function buildLookups(prisma: PrismaClient) {
  const [dbOrgs, dbPartners] = await Promise.all([
    prisma.organization.findMany({ select: { id: true, inn: true } }),
    prisma.partner.findMany({ select: { id: true, inn: true } }),
  ]);
  return {
    orgIdByInn: new Map(dbOrgs.filter((o) => o.inn).map((o) => [o.inn as string, o.id])),
    partnerIdByInn: new Map(dbPartners.filter((p) => p.inn).map((p) => [p.inn as string, p.id])),
  };
}

export async function previewImport(
  prisma: PrismaClient, session: SessionPayload, args: Args,
): Promise<{ ok: true; plan: ImportPlan } | { ok: false; error: Err }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  let parsed;
  try { parsed = await parseWorkbook(args.fileBuffer); }
  catch { return { ok: false, error: 'parse_failed' }; }

  const orgs = validateRows('orgs', parsed.orgs);
  const orders = validateRows('orders', parsed.orders);
  const payments = validateRows('payments', parsed.payments);
  const quarantine = [...orgs.quarantine, ...orders.quarantine, ...payments.quarantine];
  if (!orgs.valid.length && !orders.valid.length && !payments.valid.length) return { ok: false, error: 'empty' };

  const lookups = await buildLookups(prisma);
  const plan = planImport({ orgs: orgs.valid, orders: orders.valid, payments: payments.valid }, lookups, importScope(session));
  return { ok: true, plan: { ...plan, quarantine } };
}

export async function commitImport(
  prisma: PrismaClient, session: SessionPayload, args: Args,
): Promise<{ ok: true; applied: unknown; skipped: unknown } | { ok: false; error: Err }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  let parsed;
  try { parsed = await parseWorkbook(args.fileBuffer); }
  catch { return { ok: false, error: 'parse_failed' }; }
  const orgs = validateRows('orgs', parsed.orgs).valid;
  const orders = validateRows('orders', parsed.orders).valid;
  const payments = validateRows('payments', parsed.payments).valid;
  const { applied, skipped } = await commitTx(prisma, session, { orgs, orders, payments });
  return { ok: true, applied, skipped };
}
