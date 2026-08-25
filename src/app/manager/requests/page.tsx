import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listClientRequests } from '@/lib/services/clientRequests/list';
import { ClientRequestQueue } from '@/components/client-requests/client-request-queue';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

/** Очередь триажа обращений клиентов — менеджер (этап 5, ФТ-1.4). */
export default async function ManagerRequestsPage() {
  if (!isFeatureEnabled('client_requests')) notFound();
  const session = await requireManager();
  const { rows } = await listClientRequests(prisma, session, {});
  return (
    <div className="space-y-5">
      <PageHeader title="Обращения" subtitle="Вопросы и запросы ваших клиентов" />
      <ClientRequestQueue rows={rows} cardHrefBase="/manager/requests" />
    </div>
  );
}
