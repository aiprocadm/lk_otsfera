import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { getDocumentDetail } from '@/lib/services/documents/detail';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { DocumentDetailView } from '@/components/documents/document-detail-view';
import { EntityCustomFields } from '@/components/custom-fields/entity-custom-fields';
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
      >
        <EntityCustomFields fields={customFields} entityType="document" entityId={id} />
      </DocumentDetailView>
    </OrgAppShell>
  );
}
