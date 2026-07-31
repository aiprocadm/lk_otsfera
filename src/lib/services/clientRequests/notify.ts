import type { ClientRequest, PrismaClient } from '@prisma/client';
import {
  createNotification,
  deliverNotificationToUser,
  resolveOrgManagerRecipients,
} from '@/lib/notifications';
import { CHANNEL_RECIPIENT_SELECT } from '@/lib/notifications/channels/types';
import { log } from '@/lib/logging';
import { CLIENT_REQUEST_STATUS_LABEL } from './labels';

/**
 * Уведомления домена заявок клиентов (этап 5, Модуль 1). Обе функции
 * best-effort (§3): сбой логируется и проглатывается — уведомление не
 * блокирует подачу или триаж.
 */

/** Деталка подателя по его роли. */
export function submitterRequestUrl(request: Pick<ClientRequest, 'id' | 'source'>): string {
  return request.source === 'partner_cabinet'
    ? `/partner/requests/${request.id}`
    : `/organization/requests/${request.id}`;
}

/**
 * ФТ-1.8 (первая половина): `client_request_submitted` менеджерам при подаче.
 * В ТЗ тип назван `new_client_request` — см. `tzAlias` в
 * `lib/notifications/registry.ts`: код исторический, переименование осиротило
 * бы прошлые строки `Notification.type`.
 *
 * Для заявки организации — её
 * менеджерам; для партнёрской — менеджерам организаций партнёра (distinct).
 * Некому адресовать → без fan-out (заявка ждёт в общей очереди /manager/requests).
 */
export async function notifyManagersClientRequestSubmitted(
  prisma: PrismaClient,
  request: ClientRequest
): Promise<void> {
  try {
    let recipients: Array<{ id: string } & Record<string, unknown>> = [];
    if (request.organizationId) {
      recipients = await resolveOrgManagerRecipients(prisma, request.organizationId, {
        excludeUserId: request.submittedByUserId,
      });
    } else if (request.partnerId) {
      const assigned = await prisma.organizationManager.findMany({
        where: { isActive: true, organization: { partnerId: request.partnerId } },
        select: { userId: true },
      });
      const ids = Array.from(new Set(assigned.map((a) => a.userId))).filter(
        (id) => id !== request.submittedByUserId
      );
      if (ids.length) {
        recipients = await prisma.user.findMany({
          where: { id: { in: ids }, role: 'manager', isActive: true },
          select: CHANNEL_RECIPIENT_SELECT,
        });
      }
    }
    if (!recipients.length) return;

    const title = 'Новое обращение клиента';
    const body = `${request.companyName}: ${request.subject}`;
    for (const r of recipients) {
      const row = await createNotification({
        userId: r.id,
        organizationId: request.organizationId,
        partnerId: request.partnerId,
        type: 'client_request_submitted',
        title,
        body,
        meta: { requestId: request.id, url: '/manager/requests' },
      });
      await deliverNotificationToUser({
        userId: r.id,
        title,
        body,
        type: 'client_request_submitted',
        url: '/manager/requests',
        dedupKey: row.id,
      });
    }
  } catch (err) {
    log.warn('[clientRequests/notify] submit notify failed', {
      requestId: request.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * ФТ-1.8 (вторая половина): подателю — на КАЖДУЮ смену статуса его заявки.
 * Вызывается из всех переходов триажа (`clientRequests/triage.ts`): взятие в
 * работу, принятие и отклонение.
 */
export async function notifySubmitterClientRequestStatus(
  prisma: PrismaClient,
  request: ClientRequest
): Promise<void> {
  try {
    const statusLabel = CLIENT_REQUEST_STATUS_LABEL[request.status];
    const title = `Обращение — статус «${statusLabel}»`;
    const reason =
      request.status === 'rejected' && request.rejectedReason
        ? ` Причина: ${request.rejectedReason}`
        : '';
    const body = `Обращение «${request.subject}» (${request.companyName}) — статус «${statusLabel}».${reason}`;
    const url = submitterRequestUrl(request);
    const row = await createNotification({
      userId: request.submittedByUserId,
      organizationId: request.organizationId,
      partnerId: request.partnerId,
      type: 'client_request_status_changed',
      title,
      body,
      meta: { requestId: request.id, status: request.status, url },
    });
    await deliverNotificationToUser({
      userId: request.submittedByUserId,
      title,
      body,
      type: 'client_request_status_changed',
      url,
      dedupKey: row.id,
    });
  } catch (err) {
    log.warn('[clientRequests/notify] status notify failed', {
      requestId: request.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
