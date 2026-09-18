import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { getDocumentDetail } from '@/lib/services/documents/detail';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { DocumentDetailView } from '@/components/documents/document-detail-view';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import { DocumentVersionUploadForm } from '@/components/documents/document-version-upload-form';
import { organizationVersionUploadTarget } from '@/lib/documents/versionUpload';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { Breadcrumbs } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function OrganizationDocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);
  const { id } = await params;

  const res = await getDocumentDetail(prisma, ctx.session, id);
  if (!res.ok) notFound();

  const customFields = await getFieldsForEntity(prisma, ctx.session, 'document', id);
  // `У-251`: заменить можно только свой же загруженный файл — признак посчитал
  // сервер. Истории версий и журнала скачиваний у клиента нет (внутренний
  // контур исполнителя).
  const versionUpload = organizationVersionUploadTarget(res.document);

  return (
    <OrgAppShell
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <Breadcrumbs
        items={buildCabinetBreadcrumbs('organization', '/organization/documents', [
          { label: res.document.name },
        ])}
      />
      <DocumentDetailView
        document={res.document}
        backHref="/organization/documents"
        orderHrefBase="/organization/orders"
        // `У-150`: принять акт или договор может только заказчик — в кабинетах
        // сотрудников той же карточкой кнопка не показывается.
        canAccept
      >
        {versionUpload && (
          <DocumentVersionUploadForm
            url={versionUpload.url}
            fields={versionUpload.fields}
            documentId={id}
            currentVersion={res.document.version}
          />
        )}
        <EntityCustomFields fields={customFields} entityType="document" entityId={id} />
      </DocumentDetailView>
    </OrgAppShell>
  );
}
