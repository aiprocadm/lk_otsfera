'use server';

import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { previewImport, commitImport } from '@/lib/services/import';

export async function previewImportAction(form: FormData) {
  const session = await requireSession();
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false as const, error: 'invalid_file' as const };
  const buf = Buffer.from(await file.arrayBuffer());
  return previewImport(prisma, session, { fileBuffer: buf });
}

export async function commitImportAction(form: FormData) {
  const session = await requireSession();
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false as const, error: 'invalid_file' as const };
  const buf = Buffer.from(await file.arrayBuffer());
  return commitImport(prisma, session, { fileBuffer: buf });
}
