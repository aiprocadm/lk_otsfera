'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import {
  requestDocumentPush,
  requestDocumentPushMany,
  type RequestDocumentPushManyResult,
  type RequestDocumentPushResult,
} from '@/lib/services/documents/pushToOneC';

/**
 * «Выгрузить в 1С» / «Повторить» (`У-169`, `У-159`) — тонкий адаптер над
 * сервисом: сессия и форма здесь, права, правило компании и очередь — там.
 */

const STAFF_CABINETS = ['manager', 'leader', 'admin'] as const;

/** Карточка и список есть во всех трёх кабинетах сотрудников — обновляем все, а не тот, откуда нажали. */
function revalidateDocumentScreens(documentIds: readonly string[]): void {
  for (const cabinet of STAFF_CABINETS) {
    revalidatePath(`/${cabinet}/documents`);
    for (const id of documentIds) revalidatePath(`/${cabinet}/documents/${id}`);
  }
}

export async function requestDocumentPushAction(fd: FormData): Promise<RequestDocumentPushResult> {
  const session = await requireSession();
  const documentId = typeof fd.get('documentId') === 'string' ? String(fd.get('documentId')) : '';
  if (!documentId) return { ok: false, error: 'not_found' };

  const res = await requestDocumentPush(prisma, session, documentId);
  if (res.ok) revalidateDocumentScreens([documentId]);
  return res;
}

export async function requestDocumentPushManyAction(
  fd: FormData
): Promise<RequestDocumentPushManyResult> {
  const session = await requireSession();
  const documentIds = fd
    .getAll('documentIds')
    .filter((v): v is string => typeof v === 'string' && v !== '');

  const res = await requestDocumentPushMany(prisma, session, documentIds);
  if (res.ok && res.queued > 0) {
    revalidateDocumentScreens(
      documentIds.filter((id) => !res.skipped.some((s) => s.documentId === id))
    );
  }
  return res;
}
