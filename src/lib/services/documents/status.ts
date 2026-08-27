import type { DocumentStatus, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canTransition, isLifecycleType, STATUS_LABELS } from '@/lib/documents/statusMatrix';

/**
 * Этап 6 (`У-148`) — смена статуса документа.
 *
 * Единственная дверь к полю `status`: проверка матрицы переходов, отметки
 * «кто и когда», аудит. Прямые `update` мимо этой функции запрещены стражем
 * — иначе документ получит состояние, которого по бумаге быть не может.
 */

type Forbidden = { ok: false; error: 'forbidden' };
type NotFound = { ok: false; error: 'not_found' };
type InvalidTransition = {
  ok: false;
  error: 'invalid_transition';
  /** Что именно нельзя — для русского объяснения на экране. */
  from: DocumentStatus;
  to: DocumentStatus;
};
type NotLifecycle = { ok: false; error: 'not_lifecycle_type' };

export type SetStatusResult =
  | { ok: true }
  | Forbidden
  | NotFound
  | InvalidTransition
  | NotLifecycle;

/**
 * `actor` различает, кто двигает документ: сотрудник ЦО или заказчик.
 * Принять акт может и тот и другой (`У-150`), а аннулировать — только
 * сотрудник; сама проверка прав остаётся у вызывающего, здесь — запись
 * «кто».
 */
export async function setDocumentStatus(
  prisma: PrismaClient,
  session: SessionPayload,
  args: {
    documentId: string;
    to: DocumentStatus;
    /** Причина обязательна для аннулирования (`У-148`). */
    reason?: string | null;
  }
): Promise<SetStatusResult> {
  const doc = await prisma.document.findUnique({
    where: { id: args.documentId },
    select: { id: true, type: true, status: true },
  });
  if (!doc) return { ok: false, error: 'not_found' };
  if (!isLifecycleType(doc.type)) return { ok: false, error: 'not_lifecycle_type' };

  if (!canTransition(doc.type, doc.status, args.to)) {
    return { ok: false, error: 'invalid_transition', from: doc.status, to: args.to };
  }

  const now = new Date();
  const data: Record<string, unknown> = { status: args.to };
  if (args.to === 'sent') {
    data.sentAt = now;
    data.sentById = session.sub;
  }
  if (args.to === 'accepted') {
    data.acceptedAt = now;
    data.acceptedByUserId = session.sub;
  }
  if (args.to === 'cancelled') {
    data.cancelledAt = now;
    data.cancelReason = args.reason?.trim() || null;
  }

  await prisma.document.update({ where: { id: doc.id }, data });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'document_status_changed',
    entity: 'document',
    entityId: doc.id,
    before: { status: STATUS_LABELS[doc.status] },
    after: {
      status: STATUS_LABELS[args.to],
      ...(args.to === 'cancelled' ? { reason: args.reason?.trim() || null } : {}),
    },
  });
  return { ok: true };
}
