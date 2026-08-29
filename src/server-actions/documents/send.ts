'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { sendDocumentToCustomer, type SendDocumentResult } from '@/lib/services/documents/send';

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
