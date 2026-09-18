import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listClientRequests } from '@/lib/services/clientRequests/list';
import { ClientRequestQueue } from '@/components/client-requests/client-request-queue';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

/** Очередь триажа обращений клиентов — админ (этап 5, Model A: видит всё). */
export default async function AdminRequestsPage() {
  const session = await requireAdmin();
  const { rows } = await listClientRequests(prisma, session, {});
  return (
    <div className="space-y-5">
      <PageHeader
        title="Обращения"
        subtitle="Вопросы и запросы клиентов — то, с чего обычно начинается работа"
      />
      <ClientRequestQueue rows={rows} cardHrefBase="/admin/requests" />
    </div>
  );
}
