import React from 'react';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listClientRequests } from '@/lib/services/clientRequests/list';
import { ClientRequestQueue } from '@/components/client-requests/client-request-queue';

export const dynamic = 'force-dynamic';

/** Очередь триажа обращений клиентов — админ (этап 5, Model A: видит всё). */
export default async function AdminRequestsPage() {
  if (!isFeatureEnabled('client_requests')) notFound();
  const session = await requireAdmin();
  const { rows } = await listClientRequests(prisma, session, {});
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-[#111111]">Обращения</h1>
      <ClientRequestQueue rows={rows} />
    </div>
  );
}
