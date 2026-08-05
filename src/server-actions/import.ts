'use server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { previewImport, commitImport } from '@/lib/services/import';
// Т-5: предел один на конфиг, действие и текст в форме. Локальной копии больше нет.
import { IMPORT_MAX_FILE_BYTES } from '@/lib/config/import-limits';

async function guardedBuffer(
  form: FormData
): Promise<{ ok: true; buf: Buffer; fileName: string } | { ok: false; error: 'invalid_file' }> {
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'invalid_file' };
  if (file.size > IMPORT_MAX_FILE_BYTES) return { ok: false, error: 'invalid_file' };
  // Т-13: 1С по умолчанию отдаёт .xls — принимаем оба; настоящий формат сервис
  // определяет по содержимому (Т-14), имя нужно только для подсказки.
  const name = file.name.toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    return { ok: false, error: 'invalid_file' };
  }
  return { ok: true, buf: Buffer.from(await file.arrayBuffer()), fileName: file.name };
}

export async function previewImportAction(form: FormData) {
  const session = await requireSession();
  const g = await guardedBuffer(form);
  if (!g.ok) return { ok: false as const, error: g.error };
  return previewImport(prisma, session, { fileBuffer: g.buf, fileName: g.fileName });
}

export async function commitImportAction(form: FormData) {
  const session = await requireSession();
  const g = await guardedBuffer(form);
  if (!g.ok) return { ok: false as const, error: g.error };
  return commitImport(prisma, session, { fileBuffer: g.buf, fileName: g.fileName });
}
