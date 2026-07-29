import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getDocumentDetail } from '@/lib/services/documents/detail';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { DocumentDetailView } from '@/components/documents/document-detail-view';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';

export const dynamic = 'force-dynamic';

/**
 * Карточка документа в кабинете менеджера. Руководителю отдельная страница не
 * нужна: у него роль `manager`, префикс `/manager` ему открыт (§4 CLAUDE.md),
 * а список документов и так живёт здесь же.
 */
export default async function ManagerDocumentDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireManager();
  const { id } = await params;

  const res = await getDocumentDetail(prisma, session, id);
  if (!res.ok) notFound();

  const customFields = await getFieldsForEntity(prisma, session, 'document', id);

  return (
    <DocumentDetailView
      document={res.document}
      backHref='/manager/documents'
      orderHrefBase='/manager/orders'
    >
      <EntityCustomFields fields={customFields} entityType='document' entityId={id} />
    </DocumentDetailView>
  );
}
