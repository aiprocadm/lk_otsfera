import React from 'react';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getDocumentDetail } from '@/lib/services/documents/detail';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { DocumentDetailView } from '@/components/documents/document-detail-view';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
import { DocumentOneCPushBlock } from '@/components/documents/document-onec-push-block';
import { settingsSectionHref } from '@/lib/navigation/settings';
import { getDocumentHistory } from '@/lib/services/documents/history';
import { DocumentVersionHistory } from '@/components/documents/document-version-history';
import { DocumentVersionUploadForm } from '@/components/documents/document-version-upload-form';
import { DocumentDownloads } from '@/components/documents/document-downloads';
import { adminVersionUploadTarget } from '@/lib/documents/versionUpload';

export const dynamic = 'force-dynamic';

export default async function AdminDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;

  const res = await getDocumentDetail(prisma, session, id);
  if (!res.ok) notFound();

  const customFields = await getFieldsForEntity(prisma, session, 'document', id);
  // `У-251`, `У-254`: те же блоки, что у менеджера и руководителя (зеркало).
  const history = await getDocumentHistory(prisma, session, id);
  const versionUpload = adminVersionUploadTarget(res.document);

  return (
    <DocumentDetailView
      document={res.document}
      backHref="/admin/documents"
      breadcrumbs={buildCabinetBreadcrumbs('admin', '/admin/documents', [
        { label: res.document.name },
      ])}
      orderHrefBase="/admin/orders"
      // `У-149`: администратор — тот же сотрудник исполнителя, что менеджер и
      // руководитель; правило зеркала (§0.2) не терпит кнопки «через одного».
      canSend
    >
      {/* `У-169`: блок выгрузки в 1С — как у менеджера и руководителя (зеркало). */}
      <DocumentOneCPushBlock
        documentId={id}
        push={res.document.oneCPush}
        pushRuleHref={settingsSectionHref('catalogs.requisites', 'admin')}
        pushedVersionInOneC={history.ok ? history.history.pushedVersionInOneC : null}
      />
      {versionUpload && (
        <DocumentVersionUploadForm
          url={versionUpload.url}
          fields={versionUpload.fields}
          documentId={id}
          currentVersion={res.document.version}
        />
      )}
      {history.ok && (
        <>
          <DocumentVersionHistory
            versions={history.history.versions}
            currentId={id}
            hrefBase="/admin/documents"
          />
          {/* `У-254`: у администратора журнал действий есть — ведём в него. */}
          <DocumentDownloads
            downloads={history.history.downloads}
            auditHref={settingsSectionHref('security.audit', 'admin')}
          />
        </>
      )}
      <EntityCustomFields fields={customFields} entityType="document" entityId={id} />
    </DocumentDetailView>
  );
}
