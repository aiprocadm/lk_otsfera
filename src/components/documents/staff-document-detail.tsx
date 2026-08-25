import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getDocumentDetail } from '@/lib/services/documents/detail';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { DocumentDetailView } from '@/components/documents/document-detail-view';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Карточка документа сотрудника ЦО — одна на кабинет менеджера и кабинет
 * руководителя (`У-110`). Раньше страница была только у менеджера, и из списка
 * руководителя (которого тоже не было) уходить было некуда.
 *
 * Все адреса — список, крошки, ссылка на заказ — собираются из `cabinet`:
 * человек остаётся в своём кабинете, а не проваливается в чужой.
 */
export async function StaffDocumentDetail({
  session,
  cabinet,
  params,
}: {
  session: SessionPayload;
  cabinet: 'manager' | 'leader';
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const res = await getDocumentDetail(prisma, session, id);
  if (!res.ok) notFound();

  const customFields = await getFieldsForEntity(prisma, session, 'document', id);
  const listHref = `/${cabinet}/documents`;

  return (
    <DocumentDetailView
      document={res.document}
      backHref={listHref}
      breadcrumbs={buildCabinetBreadcrumbs(cabinet, listHref, [{ label: res.document.name }])}
      orderHrefBase={`/${cabinet}/orders`}
    >
      <EntityCustomFields fields={customFields} entityType="document" entityId={id} />
    </DocumentDetailView>
  );
}
