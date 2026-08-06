'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { previewImport, commitImport } from '@/lib/services/import';
import { planImportRollback, rollbackImport } from '@/lib/services/import/rollback';
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

/** Т-41: выбор компании для новых организаций (admin). Пусто → сервис решит сам. */
function companyIdOf(form: FormData): { companyId?: string } {
  const raw = form.get('companyId');
  return typeof raw === 'string' && raw.trim() ? { companyId: raw.trim() } : {};
}

export async function previewImportAction(form: FormData) {
  const session = await requireSession();
  const g = await guardedBuffer(form);
  if (!g.ok) return { ok: false as const, error: g.error };
  return previewImport(prisma, session, {
    fileBuffer: g.buf,
    fileName: g.fileName,
    ...companyIdOf(form),
  });
}

export async function commitImportAction(form: FormData) {
  const session = await requireSession();
  const g = await guardedBuffer(form);
  if (!g.ok) return { ok: false as const, error: g.error };
  return commitImport(prisma, session, {
    fileBuffer: g.buf,
    fileName: g.fileName,
    ...companyIdOf(form),
  });
}

/** Этап 9 (Т-39): план отката для диалога — счётчики и конфликты, без записи. */
export async function planImportRollbackAction(batchId: string) {
  const session = await requireSession();
  return planImportRollback(prisma, session, { batchId });
}

/** Этап 9 (Т-35…Т-38): сам откат; после успеха обновляем обе Excel-страницы. */
export async function rollbackImportAction(batchId: string, partial: boolean) {
  const session = await requireSession();
  const result = await rollbackImport(prisma, session, { batchId, partial });
  if (result.ok) {
    revalidatePath('/admin/settings/integrations/1c/excel');
    revalidatePath('/leader/settings/integrations/1c/excel');
  }
  return result;
}
