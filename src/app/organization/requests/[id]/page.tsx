import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getClientRequest } from '@/lib/services/clientRequests/list';
import { listClientRequestAttachments } from '@/lib/services/clientRequests/attachments';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { ClientRequestDetailView } from '@/components/client-requests/client-request-detail-view';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

export const dynamic = 'force-dynamic';

/** Деталка обращения подателя-организации (этап 5, ФТ-1.3). */
export default async function OrganizationRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isFeatureEnabled('client_requests')) notFound();
  const ctx = await getOrgPageContext({});
  const { id } = await params;
  // canSee-чек (§4): getClientRequest скоупит по сессии — чужое обращение = not_found.
  const r = await getClientRequest(prisma, ctx.session, id);
  if (!r.ok) notFound();
  const attachmentsResult = await listClientRequestAttachments(prisma, ctx.session, {
    requestId: id,
  });
  const attachments = attachmentsResult.ok ? attachmentsResult.rows : [];
  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <ClientRequestDetailView
        request={r.request}
        attachments={attachments.map((a) => ({
          id: a.id,
          name: a.name,
          size: a.size,
          mimeType: a.mimeType,
          createdAt: a.createdAt.toISOString(),
          createdByUserName: a.createdByUserName,
        }))}
        backHref="/organization/requests"
      breadcrumbs={buildCabinetBreadcrumbs('organization', '/organization/requests', [
        { label: r.request.subject },
      ])}
      />
    </OrgAppShell>
  );
}
