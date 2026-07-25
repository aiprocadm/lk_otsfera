import React from 'react';
import { notFound } from 'next/navigation';
import { requirePartner } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getClientRequest } from '@/lib/services/clientRequests/list';
import { listClientRequestAttachments } from '@/lib/services/clientRequests/attachments';
import { ClientRequestDetailView } from '@/components/client-requests/client-request-detail-view';

export const dynamic = 'force-dynamic';

/** Деталка обращения подателя-партнёра (этап 5, ФТ-1.3). */
export default async function PartnerRequestDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isFeatureEnabled('client_requests')) notFound();
  const session = await requirePartner();
  const { id } = await params;
  // canSee-чек (§4): getClientRequest скоупит по сессии — чужое обращение = not_found.
  const r = await getClientRequest(prisma, session, id);
  if (!r.ok) notFound();
  const attachmentsResult = await listClientRequestAttachments(prisma, session, { requestId: id });
  const attachments = attachmentsResult.ok ? attachmentsResult.rows : [];
  return (
    <ClientRequestDetailView
      request={r.request}
      attachments={attachments.map((a) => ({
        id: a.id,
        name: a.name,
        size: a.size,
        mimeType: a.mimeType,
        createdAt: a.createdAt.toISOString(),
        createdByUserName: a.createdByUserName
      }))}
      backHref='/partner/requests'
    />
  );
}
