import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listClientRequests } from '@/lib/services/clientRequests/list';
import { ClientRequestQueue } from '@/components/client-requests/client-request-queue';

import { PageHeader } from '@/components/ui/page-header';
import { INBOUND_SECTION_LINE } from '@/lib/help/inboundSections';
export const dynamic = 'force-dynamic';

/** Очередь триажа обращений клиентов — менеджер (этап 5, ФТ-1.4). */
export default async function ManagerRequestsPage() {
  const session = await requireManager();
  const { rows } = await listClientRequests(prisma, session, {});
  return (
    <div className="space-y-5">
      <PageHeader title="Обращения" subtitle={INBOUND_SECTION_LINE.requests} />
      <ClientRequestQueue rows={rows} cardHrefBase="/manager/requests" />
    </div>
  );
}
