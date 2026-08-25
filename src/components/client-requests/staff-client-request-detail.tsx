import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getClientRequest } from '@/lib/services/clientRequests/list';
import { listClientRequestAttachments } from '@/lib/services/clientRequests/attachments';
import { ClientRequestDetailView } from '@/components/client-requests/client-request-detail-view';
import { ClientRequestStaffActions } from '@/components/client-requests/client-request-staff-actions';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Деталка обращения у сотрудника ЦО (`У-116`).
 *
 * Экрана не было вовсе: обращение можно было только развернуть строкой в
 * очереди. Ссылкой на обращение нельзя было поделиться, а в разговоре «открой
 * вот это обращение» означало «найди его в списке и разверни».
 *
 * Экран — ТОТ ЖЕ компонент, что видит клиент, плюс действия сотрудника. Скоуп
 * режет сервис (`getClientRequest` фильтрует по сессии): чужое обращение — это
 * `not_found`, а не пустая карточка.
 */
export async function StaffClientRequestDetail({
  session,
  cabinet,
  params,
}: {
  session: SessionPayload;
  cabinet: 'admin' | 'manager' | 'leader';
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await getClientRequest(prisma, session, id);
  if (!res.ok) notFound();

  const attachmentsResult = await listClientRequestAttachments(prisma, session, { requestId: id });
  const attachments = attachmentsResult.ok ? attachmentsResult.rows : [];
  const listHref = `/${cabinet}/requests`;

  return (
    <ClientRequestDetailView
      request={res.request}
      attachments={attachments.map((a) => ({
        id: a.id,
        name: a.name,
        size: a.size,
        mimeType: a.mimeType,
        createdAt: a.createdAt.toISOString(),
        createdByUserName: a.createdByUserName,
      }))}
      backHref={listHref}
      breadcrumbs={buildCabinetBreadcrumbs(cabinet, listHref, [{ label: res.request.subject }])}
      actions={
        <ClientRequestStaffActions
          request={res.request}
          // Лид живёт в кабинете менеджера: у админа и руководителя своего
          // раздела лидов нет, поэтому ссылка ведёт туда, где он открывается.
          leadHrefBase="/manager/leads"
        />
      }
    />
  );
}
