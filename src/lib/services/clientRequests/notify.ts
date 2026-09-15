import type { ClientRequest, PrismaClient } from '@prisma/client';
import {
  createNotification,
  deliverNotificationToUser,
  resolveOrgManagerRecipients,
} from '@/lib/notifications';
import { emitAutomationEvent } from '@/lib/automation/dispatch';
import { CHANNEL_RECIPIENT_SELECT } from '@/lib/notifications/channels/types';
import { log } from '@/lib/logging';
import { getSettingValue } from '@/lib/config/integrationSettings';
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
  // `У-223`: обращение поступило — событие для правил автоматизации.
  //
  // Врезка стоит у ОБЩЕГО нотификатора, а не у двух дверей подачи (кабинет и
  // форма сайта): обе они и так сходятся здесь, а две врезки однажды
  // разошлись бы — и половина обращений перестала бы запускать правила молча.
  //
  // Компания берётся через организацию: у `ClientRequest` своего поля компании
  // нет. У заявки с сайта организации может не быть вовсе — тогда правил не
  // запускаем, потому что непонятно, чьи они.
  await emitClientRequestSubmitted(prisma, request);

  try {
    let recipients: Array<{ id: string } & Record<string, unknown>> = [];
    if (request.organizationId) {
      recipients = await resolveOrgManagerRecipients(prisma, request.organizationId, {
        // Автора исключаем, только если он есть: у заявки с сайта его нет.
        ...(request.submittedByUserId ? { excludeUserId: request.submittedByUserId } : {}),
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
          where: { id: { in: ids }, role: { in: ['manager', 'leader'] }, isActive: true },
          select: CHANNEL_RECIPIENT_SELECT,
        });
      }
    } else {
      // `У-211`: у заявки с сайта нет ни организации, ни партнёра — она
      // пришла от постороннего. Без этой ветки уведомление молча не ушло бы
      // НИКОМУ, и заявку заметили бы только при следующем открытии
      // «Входящих в работу». Адресаты — менеджер по умолчанию из настройки
      // раздела «Сайт», а если он не задан — весь контур ЦО.
      const defaultManagerId = (await getSettingValue(prisma, 'site.defaultManagerId'))?.trim();
      if (defaultManagerId) {
        recipients = await prisma.user.findMany({
          where: { id: defaultManagerId, role: { in: ['manager', 'leader'] }, isActive: true },
          select: CHANNEL_RECIPIENT_SELECT,
        });
      }
      // Откат на весь контур ЦО: названный в настройке человек мог уволиться
      // или сменить роль, и тогда заявка с сайта не дошла бы НИ ДО КОГО — её
      // заметили бы только при следующем открытии «Входящих в работу».
      // Компанию здесь не фильтруем намеренно: у заявки с сайта её нет, и
      // разобрать такую заявку может любой продавец (то же правило, что у
      // общей очереди непривязанных обращений).
      if (recipients.length === 0) {
        recipients = await prisma.user.findMany({
          where: { role: { in: ['manager', 'leader'] }, isActive: true },
          select: CHANNEL_RECIPIENT_SELECT,
        });
      }
    }
    if (!recipients.length) return;

    // Источник видно сразу: заявка с сайта разбирается иначе, чем из кабинета
    // (клиента в системе может не быть вовсе).
    const title = request.source === 'website' ? 'Новая заявка с сайта' : 'Новое обращение клиента';
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
    // Заявку с сайта прислал посторонний: уведомлять о смене статуса некого —
    // учётной записи у него нет, и писать ему кабинет пока не умеет. Ответ
    // уйдёт письмом или звонком, когда менеджер возьмёт заявку в работу.
    if (!request.submittedByUserId) return;

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

/** `У-223`: событие «поступило обращение» для правил автоматизации. */
async function emitClientRequestSubmitted(
  prisma: PrismaClient,
  request: ClientRequest
): Promise<void> {
  let companyId: string | null = null;
  if (request.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: request.organizationId },
      select: { companyId: true },
    });
    companyId = org?.companyId ?? null;
  }
  await emitAutomationEvent(prisma, {
    trigger: 'client_request_submitted',
    companyId,
    payload: {
      clientRequestId: request.id,
      organizationId: request.organizationId,
      partnerId: request.partnerId,
      source: request.source,
      subject: request.subject,
      organizationName: request.companyName,
      responsibleManagerId: null,
    },
  });
}
