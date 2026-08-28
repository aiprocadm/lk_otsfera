import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { notifyManagers } from '@/lib/notifications';
import { log } from '@/lib/logging';
import { setDocumentStatus } from './status';

/**
 * Приёмка документа заказчиком (`У-150`).
 *
 * Заказчик нажимает «Принять» на акте или договоре — документ переходит в
 * `accepted`, а менеджер получает уведомление. Счёт **не принимают вручную**:
 * его состояние определяют платежи (`У-148`), и кнопка «Оплачено» у клиента
 * была бы способом объявить оплату, которой не было.
 *
 * Права: документ должен быть виден вызывающему (`canReadDocument` — тот же
 * предикат, что у скачивания, §4 defense-in-depth), а роль — клиентской.
 * Сотрудник ЦО принимает документ своим действием, не этим.
 */

export type AcceptDocumentResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'not_found' | 'not_acceptable' | 'invalid_transition' };

/** Что вообще можно «принять»: подписываемые бумаги, а не счёт. */
const ACCEPTABLE_TYPES = new Set(['act', 'contract', 'extra_agreement']);

export async function acceptDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  documentId: string
): Promise<AcceptDocumentResult> {
  if (session.role !== 'organization') return { ok: false, error: 'forbidden' };

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      type: true,
      number: true,
      orderId: true,
      companyId: true,
      counterpartyType: true,
      counterpartyId: true,
      order: { select: { id: true, companyId: true, managerId: true, orderNumber: true } },
    },
  });
  if (!doc) return { ok: false, error: 'not_found' };
  if (!(await canReadDocument(session, doc))) return { ok: false, error: 'not_found' };
  if (!ACCEPTABLE_TYPES.has(doc.type)) return { ok: false, error: 'not_acceptable' };

  const changed = await setDocumentStatus(prisma, session, { documentId, to: 'accepted' });
  if (!changed.ok) {
    // Матрица уже сказала, что переход невозможен (например, документ
    // аннулирован) — не переспрашиваем и не притворяемся успехом.
    return { ok: false, error: changed.error === 'not_found' ? 'not_found' : 'invalid_transition' };
  }

  // Уведомление менеджеру — best-effort (§3): документ уже принят, и сбой
  // доставки не должен выглядеть как отказ в приёмке.
  if (doc.order) {
    try {
      await notifyManagers(prisma, {
        orderId: doc.order.id,
        type: 'document_accepted',
        payload: {
          documentId: doc.id,
          documentType: doc.type,
          documentNumber: doc.number,
          orderNumber: doc.order.orderNumber,
        },
      });
    } catch (err) {
      log.warn('[documents/accept] notify failed', {
        documentId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: true };
}
