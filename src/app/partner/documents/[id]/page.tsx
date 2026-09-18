import React from 'react';
import { notFound } from 'next/navigation';
import { requirePartner } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getDocumentDetail } from '@/lib/services/documents/detail';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { DocumentDetailView } from '@/components/documents/document-detail-view';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import { DocumentVersionUploadForm } from '@/components/documents/document-version-upload-form';
import { partnerVersionUploadTarget } from '@/lib/documents/versionUpload';

export const dynamic = 'force-dynamic';

export default async function PartnerDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePartner();
  const { id } = await params;

  const res = await getDocumentDetail(prisma, session, id);
  if (!res.ok) notFound();

  const customFields = await getFieldsForEntity(prisma, session, 'document', id);
  // `У-251`: партнёр меняет версию только своего загруженного файла.
  const versionUpload = partnerVersionUploadTarget(res.document);

  return (
    <DocumentDetailView
      document={res.document}
      backHref="/partner/documents"
      breadcrumbs={buildCabinetBreadcrumbs('partner', '/partner/documents', [
        { label: res.document.name },
      ])}
      orderHrefBase="/partner/orders"
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
  );
}
