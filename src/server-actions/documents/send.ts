'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { sendDocumentToCustomer, type SendDocumentResult } from '@/lib/services/documents/send';
import { sendDocumentsToClients, type SendManyResult } from '@/lib/services/documents/sendMany';

/**
 * «Отправить заказчику» (`У-149`) — тонкий адаптер над сервисом: сессия и
 * форма здесь, права, вложение, письмо и журнал — там.
 */
export async function sendDocumentAction(fd: FormData): Promise<SendDocumentResult> {
  const session = await requireSession();
  const documentId = typeof fd.get('documentId') === 'string' ? String(fd.get('documentId')) : '';
  if (!documentId) return { ok: false, error: 'not_found' };

  const res = await sendDocumentToCustomer(prisma, session, documentId);
  if (res.ok) {
    // Карточка документа есть в обоих кабинетах сотрудников — обновляем обе,
    // иначе отметка «Отправлен» появится только там, откуда нажали.
    revalidatePath(`/manager/documents/${documentId}`);
    revalidatePath(`/leader/documents/${documentId}`);
  }
  return res;
}

/**
 * «Отправить клиенту» из списка (`У-258`) — то же тонкое правило: сессия и
 * форма здесь, отбор, письма и журнал — в сервисе.
 *
 * Обновляем карточки только тех документов, которые реально ушли: обновить
 * пропущенные значило бы показать «Отправлен» там, где отправки не было.
 */
export async function sendDocumentsToClientsAction(fd: FormData): Promise<SendManyResult> {
  const session = await requireSession();
  const documentIds = fd
    .getAll('documentIds')
    .filter((v): v is string => typeof v === 'string' && v !== '');

  const res = await sendDocumentsToClients(prisma, session, documentIds);
  if (res.ok && res.sent > 0) {
    const failed = new Set(res.skipped.map((s) => s.documentId));
    for (const id of documentIds) {
      if (failed.has(id)) continue;
      revalidatePath(`/manager/documents/${id}`);
      revalidatePath(`/leader/documents/${id}`);
    }
  }
  return res;
}
