import React from 'react';
import type { ClientRequestRow } from '@/lib/services/clientRequests/list';
import type { ClientRequestAttachmentRow } from '@/lib/services/clientRequests/attachments';
import { ClientRequestDetailView } from '@/components/client-requests/client-request-detail-view';
import { ClientRequestStaffActions } from '@/components/client-requests/client-request-staff-actions';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

/**
 * Деталка обращения у сотрудника ЦО (`У-116`).
 *
 * Экрана не было вовсе: обращение можно было только развернуть строкой в
 * очереди. Ссылкой на обращение нельзя было поделиться, а в разговоре «открой
 * вот это обращение» означало «найди его в списке и разверни».
 *
 * Экран — ТОТ ЖЕ компонент, что видит клиент, плюс действия сотрудника.
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборку делает страница своей роли, скоуп
 * режет сервис (`getClientRequest` фильтрует по сессии): чужое обращение — это
 * `not_found` на странице, а не пустая карточка.
 */
export function StaffClientRequestDetail({
  cabinet,
  request,
  attachments,
}: {
  cabinet: 'admin' | 'manager' | 'leader';
  request: ClientRequestRow;
  attachments: ClientRequestAttachmentRow[];
}) {
  const listHref = `/${cabinet}/requests`;

  return (
    <ClientRequestDetailView
      request={request}
      attachments={attachments.map((a) => ({
        id: a.id,
        name: a.name,
        size: a.size,
        mimeType: a.mimeType,
        createdAt: a.createdAt.toISOString(),
        createdByUserName: a.createdByUserName,
      }))}
      backHref={listHref}
      breadcrumbs={buildCabinetBreadcrumbs(cabinet, listHref, [{ label: request.subject }])}
      actions={
        <ClientRequestStaffActions
          request={request}
          // Лид живёт в кабинете менеджера: у админа и руководителя своего
          // раздела лидов нет, поэтому ссылка ведёт туда, где он открывается.
          leadHrefBase="/manager/leads"
        />
      }
    />
  );
}
