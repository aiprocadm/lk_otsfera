import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listClientRequests } from '@/lib/services/clientRequests/list';
import { ClientRequestQueue } from '@/components/client-requests/client-request-queue';

export const dynamic = 'force-dynamic';

/** Очередь триажа обращений клиентов — менеджер (этап 5, ФТ-1.4). */
export default async function ManagerRequestsPage() {
  if (!isFeatureEnabled('client_requests')) notFound();
  const session = await requireManager();
  const { rows } = await listClientRequests(prisma, session, {});
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-[#111111]">Обращения</h1>
      {/* `У-73`: одна строка «что здесь делают». */}
      <p className="text-sm text-gray-500 mt-0.5">Вопросы и запросы ваших клиентов</p>
      <ClientRequestQueue rows={rows} />
    </div>
  );
}
