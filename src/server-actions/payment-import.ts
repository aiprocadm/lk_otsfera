'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import type { CounterpartyOverride } from '@/lib/services/import/oneCAccountCard/new-counterparties';
import { requireSession } from '@/lib/auth/requireRole';
import {
  previewPaymentImport,
  commitPaymentImport,
  resolveQueueRow,
  dismissQueueRow,
  searchResolveOrgs,
  listResolveOrders,
  createOrgFromQueueRow,
  planQueueOrgCreation,
  createOrgsFromQueueRows,
} from '@/lib/services/import/oneCAccountCard';
// Т-5: тот же предел, что у импорта Excel и в next.config.
import { IMPORT_MAX_FILE_BYTES } from '@/lib/config/import-limits';

async function guarded(
  form: FormData
): Promise<{ ok: true; buf: Buffer; name: string } | { ok: false; error: 'invalid_file' }> {
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'invalid_file' };
  if (file.size > IMPORT_MAX_FILE_BYTES) return { ok: false, error: 'invalid_file' };
  const name = file.name.toLowerCase();
  if (!name.endsWith('.xls') && !name.endsWith('.xlsx'))
    return { ok: false, error: 'invalid_file' };
  return { ok: true, buf: Buffer.from(await file.arrayBuffer()), name: file.name };
}

/** `У-50`: компания для новых организаций (admin). Пусто → сервис решит сам. */
function companyIdOf(form: FormData): { companyId?: string } {
  const raw = form.get('companyId');
  return typeof raw === 'string' && raw.trim() ? { companyId: raw.trim() } : {};
}

export async function previewPaymentImportAction(form: FormData) {
  const session = await requireSession();
  const g = await guarded(form);
  if (!g.ok) return { ok: false as const, error: g.error };
  return previewPaymentImport(prisma, session, {
    fileBuffer: g.buf,
    fileName: g.name,
    ...companyIdOf(form),
  });
}

/**
 * `У-87`: правки предпросмотра. Форма шлёт их JSON-строкой (снятые галочки и
 * вписанные ИНН); негодный JSON — просто отсутствие правок, а не отказ импорта:
 * сервер всё равно перепроверит каждую правку по ключу контрагента.
 */
function overridesOf(form: FormData): { overrides?: CounterpartyOverride[] } {
  const raw = form.get('overrides');
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const clean = parsed
      .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
      .filter((o) => typeof o.key === 'string')
      .map((o) => ({
        key: o.key as string,
        ...(typeof o.create === 'boolean' ? { create: o.create } : {}),
        ...(typeof o.inn === 'string' ? { inn: o.inn } : {}),
      }));
    return clean.length > 0 ? { overrides: clean } : {};
  } catch {
    return {};
  }
}

export async function commitPaymentImportAction(form: FormData) {
  const session = await requireSession();
  const g = await guarded(form);
  if (!g.ok) return { ok: false as const, error: g.error };
  return commitPaymentImport(prisma, session, {
    fileBuffer: g.buf,
    fileName: g.name,
    ...companyIdOf(form),
    ...overridesOf(form),
  });
}

export async function resolveQueueRowAction(args: {
  rowId: string;
  organizationId: string;
  orderId: string | null;
}) {
  const session = await requireSession();
  return resolveQueueRow(prisma, session, args);
}

export async function dismissQueueRowAction(args: { rowId: string }) {
  const session = await requireSession();
  return dismissQueueRow(prisma, session, args);
}

export async function searchResolveOrgsAction(args: { q?: string }) {
  const session = await requireSession();
  return searchResolveOrgs(prisma, session, args);
}

export async function listResolveOrdersAction(args: { organizationId: string }) {
  const session = await requireSession();
  return listResolveOrders(prisma, session, args);
}

/**
 * `У-53`, шаг 1 (`Р-10`): список того, что будет создано пакетно. Ничего не
 * пишет — без показа списка второй шаг вызывать нельзя.
 */
export async function planQueueOrgCreationAction() {
  const session = await requireSession();
  return planQueueOrgCreation(prisma, session);
}

/** `У-53`, шаг 2: создать организации по отмеченным строкам очереди. */
export async function createOrgsFromQueueRowsAction(args: {
  rowIds: string[];
  companyId?: string;
}) {
  const session = await requireSession();
  const res = await createOrgsFromQueueRows(prisma, session, args);
  if (res.ok) {
    for (const cabinet of ['/admin', '/leader']) {
      revalidatePath(`${cabinet}/settings/integrations/1c/payments`);
    }
    revalidatePath('/manager/payments-import');
  }
  return res;
}

/** Этап 10 (Т-30): создание организации из строки очереди + привязка платежа. */
export async function createOrgFromQueueRowAction(args: {
  rowId: string;
  name: string;
  inn: string;
  kpp?: string | null;
  companyId?: string;
}) {
  const session = await requireSession();
  const result = await createOrgFromQueueRow(prisma, session, args);
  if (result.ok) {
    revalidatePath('/admin/settings/integrations/1c/payments');
    revalidatePath('/leader/settings/integrations/1c/payments');
  }
  return result;
}
