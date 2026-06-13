'use server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { previewImport, commitImport } from '@/lib/services/import';

const MAX_BYTES = 20 * 1024 * 1024;

async function guardedBuffer(form: FormData): Promise<{ ok: true; buf: Buffer } | { ok: false; error: 'invalid_file' }> {
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'invalid_file' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'invalid_file' };
  if (!file.name.toLowerCase().endsWith('.xlsx')) return { ok: false, error: 'invalid_file' };
  return { ok: true, buf: Buffer.from(await file.arrayBuffer()) };
}

export async function previewImportAction(form: FormData) {
  const session = await requireSession();
  const g = await guardedBuffer(form);
  if (!g.ok) return { ok: false as const, error: g.error };
  return previewImport(prisma, session, { fileBuffer: g.buf });
}

export async function commitImportAction(form: FormData) {
  const session = await requireSession();
  const g = await guardedBuffer(form);
  if (!g.ok) return { ok: false as const, error: g.error };
  return commitImport(prisma, session, { fileBuffer: g.buf });
}
