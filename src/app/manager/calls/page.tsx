import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listCalls, type CallsFilters } from '@/lib/services/telephony/listCalls';
import { CallsFiltersBar } from '@/components/manager/calls-filters';
import { CallsList } from '@/components/manager/calls-list';
import { Paginator } from '@/components/ui';

export const dynamic = 'force-dynamic';

type SearchParams = {
  direction?: string;
  orgId?: string;
  page?: string;
};

const PAGE_SIZE = 25;

export default async function ManagerCallsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!isFeatureEnabled('telephony_mango')) notFound();

  const session = await requireManager();
  const sp = await searchParams;

  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const direction = sp.direction === 'inbound' || sp.direction === 'outbound' ? sp.direction : undefined;
  const filters: CallsFilters = {
    ...(direction ? { direction } : {}),
    ...(sp.orgId ? { orgId: sp.orgId } : {}),
    page,
    pageSize: PAGE_SIZE
  };

  const { items, total } = await listCalls(prisma, session, filters);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Звонки</h1>
        <p className="mt-1 text-sm text-gray-500">
          Журнал звонков телефонии. Запись доступна после проверки антивирусом.
        </p>
      </div>

      <CallsFiltersBar direction={sp.direction} />

      <CallsList items={items} />

      <Paginator
        basePath="/manager/calls"
        searchParams={sp}
        take={PAGE_SIZE}
        skip={(page - 1) * PAGE_SIZE}
        total={total}
      />
    </div>
  );
}
