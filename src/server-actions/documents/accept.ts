'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { acceptDocument, type AcceptDocumentResult } from '@/lib/services/documents/accept';

/**
 * «Принять» документ заказчиком (`У-150`) — тонкий адаптер над сервисом:
 * сессия и форма входа здесь, права, матрица статусов и уведомление — там.
 */
export async function acceptDocumentAction(fd: FormData): Promise<AcceptDocumentResult> {
  const session = await requireSession();
  const documentId = typeof fd.get('documentId') === 'string' ? String(fd.get('documentId')) : '';
  if (!documentId) return { ok: false, error: 'not_found' };

  const res = await acceptDocument(prisma, session, documentId);
  if (res.ok) revalidatePath(`/organization/documents/${documentId}`);
  return res;
}
