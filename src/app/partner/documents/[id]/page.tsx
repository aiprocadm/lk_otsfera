import React from 'react';
import { notFound } from 'next/navigation';
import { requirePartner } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getDocumentDetail } from '@/lib/services/documents/detail';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { DocumentDetailView } from '@/components/documents/document-detail-view';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';

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

  return (
    <DocumentDetailView
      document={res.document}
      backHref="/partner/documents"
      orderHrefBase="/partner/deals"
    >
      <EntityCustomFields fields={customFields} entityType="document" entityId={id} />
    </DocumentDetailView>
  );
}
