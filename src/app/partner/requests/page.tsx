import React from 'react';
import { notFound } from 'next/navigation';
import { requirePartner } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listClientRequests } from '@/lib/services/clientRequests/list';
import { ClientRequestForm } from '@/components/client-requests/client-request-form';
import { ClientRequestList } from '@/components/client-requests/client-request-list';

export const dynamic = 'force-dynamic';

/** Обращения партнёра (этап 5, ФТ-1.2/1.3): форма подачи + свои обращения. */
export default async function PartnerRequestsPage() {
  if (!isFeatureEnabled('client_requests')) notFound();
  const session = await requirePartner();
  const { rows } = await listClientRequests(prisma, session, {});
  return (
    <div className='space-y-5'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Обращения</h1>
      <ClientRequestForm />
      <ClientRequestList rows={rows} detailHrefBase='/partner/requests' />
    </div>
  );
}
