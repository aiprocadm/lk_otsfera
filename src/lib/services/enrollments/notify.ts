import type { PrismaClient, EnrollmentRequest } from '@prisma/client';
import {
  createNotification,
  deliverNotificationToUser,
  resolveOrgManagerRecipients,
} from '@/lib/notifications';
import { log } from '@/lib/logging';
import { pluralizeRu } from '@/lib/format';
import { ENROLLMENT_STATUS_LABEL } from './labels';

/**
 * Уведомления домена заявок на обучение (этап 2 PR-2, ФТ-2.5). Обе функции
 * best-effort (§3): любой сбой логируется и проглатывается — уведомление не
 * должно блокировать подачу или lifecycle-переход.
 */

/** Деталка есть только у organization/partner; staff-податели ведут на очередь. */
export function submitterEnrollmentUrl(submitterRole: string, requestId: string): string | null {
  if (submitterRole === 'organization') return `/organization/enrollments/${requestId}`;
  if (submitterRole === 'partner') return `/partner/enrollments/${requestId}`;
  if (submitterRole === 'manager' || submitterRole === 'leader') return '/manager/enrollments';
  if (submitterRole === 'admin') return '/admin/enrollments';
  return null;
}

async function requestSummary(prisma: PrismaClient, requestId: string) {
  const detail = await prisma.enrollmentRequest.findUnique({
    where: { id: requestId },
    select: {
      legacyCourseTitle: true,
      organization: { select: { name: true } },
      _count: { select: { items: true } },
      // У-44 (этап 6): направлений в заявке теперь может быть несколько —
      // перечисляем их, а не одно с шапки.
      items: { select: { direction: { select: { name: true } } } },
    },
  });
  const count = detail?._count.items ?? 0;

  const fromItems = [
    ...new Set(
      (detail?.items ?? [])
        .map((i) => i.direction?.name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
    ),
  ];
  // `У-36`: шапочного направления больше нет. Резерв — только текстовый курс
  // старых заявок; для остальных направления всегда лежат в позициях.
  const names =
    fromItems.length > 0
      ? fromItems
      : [detail?.legacyCourseTitle].filter(
          (n): n is string => typeof n === 'string' && n.length > 0
        );

  return {
    directionName: names.length > 0 ? names.join(', ') : 'обучение',
    directionsCount: names.length,
    orgName: detail?.organization?.name ?? null,
    countText: `${count} ${pluralizeRu(count, 'слушатель', 'слушателя', 'слушателей')}`,
  };
}

/** `enrollment_status_changed` подателю (submittedByUserId) на смену статуса шапки. */
export async function notifySubmitterEnrollmentStatus(
  prisma: PrismaClient,
  request: EnrollmentRequest
): Promise<void> {
  try {
    const { directionName, directionsCount, countText } = await requestSummary(prisma, request.id);
    const statusLabel = ENROLLMENT_STATUS_LABEL[request.status];
    const title = `Заявка на обучение — статус «${statusLabel}»`;
    const reason =
      request.status === 'rejected' && request.rejectedReason
        ? ` Причина: ${request.rejectedReason}`
        : '';
    const body = `Заявка на обучение: ${countText}, ${directionsCount > 1 ? 'направления' : 'направление'} «${directionName}» — статус «${statusLabel}».${reason}`;
    const url = submitterEnrollmentUrl(request.submitterRole, request.id);
    const row = await createNotification({
      userId: request.submittedByUserId,
      organizationId: request.organizationId,
      partnerId: request.partnerId,
      type: 'enrollment_status_changed',
      title,
      body,
      meta: { requestId: request.id, status: request.status, ...(url ? { url } : {}) },
    });
    await deliverNotificationToUser({
      userId: request.submittedByUserId,
      title,
      body,
      type: 'enrollment_status_changed',
      ...(url ? { url } : {}),
      dedupKey: row.id,
    });
  } catch (err) {
    log.warn('[enrollments/notify] status notify failed', {
      requestId: request.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * `enrollment_submitted` менеджерам организации при подаче. Заявка без
 * организации адресата не имеет — fan-out пропускается.
 */
export async function notifyManagersEnrollmentSubmitted(
  prisma: PrismaClient,
  request: EnrollmentRequest
): Promise<void> {
  try {
    if (!request.organizationId) return;
    const recipients = await resolveOrgManagerRecipients(prisma, request.organizationId, {
      excludeUserId: request.submittedByUserId,
    });
    if (!recipients.length) return;
    const { directionName, directionsCount, orgName, countText } = await requestSummary(
      prisma,
      request.id
    );
    const title = 'Новая заявка на обучение';
    const body = `${orgName ? `Организация «${orgName}»: ` : ''}${countText}, ${directionsCount > 1 ? 'направления' : 'направление'} «${directionName}».`;
    for (const r of recipients) {
      const row = await createNotification({
        userId: r.id,
        organizationId: request.organizationId,
        type: 'enrollment_submitted',
        title,
        body,
        meta: { requestId: request.id, url: '/manager/enrollments' },
      });
      await deliverNotificationToUser({
        userId: r.id,
        title,
        body,
        type: 'enrollment_submitted',
        url: '/manager/enrollments',
        dedupKey: row.id,
      });
    }
  } catch (err) {
    log.warn('[enrollments/notify] submit notify failed', {
      requestId: request.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
