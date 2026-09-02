'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { acceptDocument, type AcceptDocumentResult } from '@/lib/services/documents/accept';
import { acceptProposal, type AcceptProposalResult } from '@/lib/services/documents/acceptProposal';
import { rejectProposal, type RejectProposalResult } from '@/lib/services/documents/rejectProposal';

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

/**
 * «Принять» коммерческое предложение (`У-164`) — отдельное действие, потому
 * что и последствия другие: создаётся заказ и в него переносится состав.
 *
 * Обновляются ТРИ адреса: карточка документа в кабинете сотрудника и в
 * кабинете заказчика (принять может и тот, и другой) и сам заказ — он либо
 * только что появился, либо получил состав.
 */
export async function acceptProposalAction(fd: FormData): Promise<AcceptProposalResult> {
  const session = await requireSession();
  const documentId = typeof fd.get('documentId') === 'string' ? String(fd.get('documentId')) : '';
  if (!documentId) return { ok: false, error: 'not_found' };

  const res = await acceptProposal(prisma, session, { documentId });
  if (res.ok) {
    revalidatePath(`/manager/documents/${documentId}`);
    revalidatePath(`/organization/documents/${documentId}`);
    revalidatePath(`/manager/orders/${res.orderId}`);
  }
  return res;
}

/**
 * «Отклонить» коммерческое предложение заказчиком (`У-165`) — тонкий адаптер:
 * сессия и форма входа здесь, обязательность причины и запись — в сервисе.
 */
export async function rejectProposalAction(fd: FormData): Promise<RejectProposalResult> {
  const session = await requireSession();
  const documentId = typeof fd.get('documentId') === 'string' ? String(fd.get('documentId')) : '';
  if (!documentId) return { ok: false, error: 'not_found' };
  // Пустую причину не отсекаем здесь: правило «без причины нельзя» одно, и
  // живёт оно в сервисе — иначе прямой вызов обошёл бы его.
  const reason = typeof fd.get('reason') === 'string' ? String(fd.get('reason')) : '';

  const res = await rejectProposal(prisma, session, { documentId, reason });
  if (res.ok) revalidatePath(`/organization/documents/${documentId}`);
  return res;
}
