import React from 'react';
import { DocumentDetailView } from '@/components/documents/document-detail-view';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import type { DocumentDetail } from '@/lib/services/documents/detail';
import type { FieldWithValue } from '@/lib/services/customFields';

/**
 * Карточка документа сотрудника ЦО — одна на кабинет менеджера и кабинет
 * руководителя (`У-110`). Раньше страница была только у менеджера, и из списка
 * руководителя (которого тоже не было) уходить было некуда.
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборку, скоуп сессии и `notFound()` делает
 * страница своего кабинета.
 *
 * Все адреса — список, крошки, ссылка на заказ — собираются из `cabinet`:
 * человек остаётся в своём кабинете, а не проваливается в чужой.
 *
 * `canSend` (`У-149`) включён у обоих кабинетов сотрудников: отправлять
 * документ заказчику письмом — их работа. Сервис ещё раз проверит права и
 * тип документа: кнопка на экране правами не считается.
 */
export function StaffDocumentDetail({
  cabinet,
  document,
  customFields,
}: {
  cabinet: 'manager' | 'leader';
  document: DocumentDetail;
  customFields: FieldWithValue[];
}) {
  const listHref = `/${cabinet}/documents`;

  return (
    <DocumentDetailView
      document={document}
      backHref={listHref}
      breadcrumbs={buildCabinetBreadcrumbs(cabinet, listHref, [{ label: document.name }])}
      orderHrefBase={`/${cabinet}/orders`}
      canSend
      canSetNumber
      canReissue
    >
      <EntityCustomFields fields={customFields} entityType="document" entityId={document.id} />
    </DocumentDetailView>
  );
}
