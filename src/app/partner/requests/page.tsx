import React from 'react';
import { notFound } from 'next/navigation';
import { requirePartner } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listClientRequests } from '@/lib/services/clientRequests/list';
import { ClientRequestForm } from '@/components/client-requests/client-request-form';
import { ClientRequestList } from '@/components/client-requests/client-request-list';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

/** Обращения партнёра — вопросы в поддержку (этап 5, ФТ-1.2/1.3): форма подачи + свои обращения. */
export default async function PartnerRequestsPage() {
  if (!isFeatureEnabled('client_requests')) notFound();
  const session = await requirePartner();
  const { rows } = await listClientRequests(prisma, session, {});
  return (
    <div className="space-y-5">
      <div>
        <PageHeader
          title="Обращения"
          subtitle="Обращения в поддержку: вопрос, запрос расчёта или новая потребность. Заявки на обучение слушателей подаются в разделе «Заявки на обучение»."
        />
      </div>
      <ClientRequestForm />
      <ClientRequestList rows={rows} detailHrefBase="/partner/requests" />
    </div>
  );
}
