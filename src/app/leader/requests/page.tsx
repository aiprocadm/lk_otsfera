import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listClientRequests } from '@/lib/services/clientRequests/list';
import { ClientRequestQueue } from '@/components/client-requests/client-request-queue';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

/** Очередь триажа обращений клиентов — руководитель (этап 5, ФТ-1.4). */
export default async function LeaderRequestsPage() {
  if (!isFeatureEnabled('client_requests')) notFound();
  const session = await requireManagerLeader();
  const { rows } = await listClientRequests(prisma, session, {});
  return (
    <div className="space-y-5">
      <PageHeader title="Обращения" subtitle="Вопросы и запросы клиентов по всей компании" />
      <ClientRequestQueue rows={rows} cardHrefBase="/leader/requests" />
    </div>
  );
}
