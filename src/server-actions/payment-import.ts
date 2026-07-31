'use server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import {
  previewPaymentImport,
  commitPaymentImport,
  resolveQueueRow,
  dismissQueueRow,
  searchResolveOrgs,
  listResolveOrders,
} from '@/lib/services/import/oneCAccountCard';

const MAX_BYTES = 20 * 1024 * 1024;

async function guarded(
  form: FormData
): Promise<{ ok: true; buf: Buffer; name: string } | { ok: false; error: 'invalid_file' }> {
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'invalid_file' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'invalid_file' };
  const name = file.name.toLowerCase();
  if (!name.endsWith('.xls') && !name.endsWith('.xlsx'))
    return { ok: false, error: 'invalid_file' };
  return { ok: true, buf: Buffer.from(await file.arrayBuffer()), name: file.name };
}

export async function previewPaymentImportAction(form: FormData) {
  const session = await requireSession();
  const g = await guarded(form);
  if (!g.ok) return { ok: false as const, error: g.error };
  return previewPaymentImport(prisma, session, { fileBuffer: g.buf, fileName: g.name });
}

export async function commitPaymentImportAction(form: FormData) {
  const session = await requireSession();
  const g = await guarded(form);
  if (!g.ok) return { ok: false as const, error: g.error };
  return commitPaymentImport(prisma, session, { fileBuffer: g.buf, fileName: g.name });
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
