import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrders } from '@/lib/services/manager/orders';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { ManagerOrdersFilter } from '@/components/manager/manager-orders-filter';
import { ManagerOrdersTable } from '@/components/manager/manager-orders-table';
import { ManagerOrdersCardList } from '@/components/manager/manager-orders-card-list';
import { ExportLink } from '@/components/ui';
import { getOrderedStatuses } from '@/lib/services/orderStatuses';

export const dynamic = 'force-dynamic';

type SearchParams = {
  search?: string;
  executionStatus?: string;
  financialStatus?: string;
  organizationId?: string;
  unassigned?: string;
  cursor?: string;
};

export default async function LeaderOrdersPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManagerLeader();
  const sp = await searchParams;
  const [{ rows, nextCursor }, orgs] = await Promise.all([
    listOrders(prisma, { session, ...sp, unassigned: sp.unassigned === '1', teamModeOverride: true }),
    listOrganizations(prisma, session, true)
  ]);
  // §10 ТЗ v0.5: фильтр по рабочему статусу — активные строки справочника.
  const statusOptions = (await getOrderedStatuses(prisma))
    .filter((x) => x.isActive)
    .map((x) => ({ id: x.id, label: x.label }));

  return (
    <>
      <div className='mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold text-[#111111]'>Заказы</h1>
          <p className='text-sm text-gray-500 mt-0.5'>Все заказы компании</p>
        </div>
        {/* ФТ-12.2: `scope=company` повторяет company-wide режим экрана лидера. */}
        <ExportLink
          base='/api/manager/orders/export'
          params={{
            scope: 'company',
            search: sp.search,
            executionStatus: sp.executionStatus,
            financialStatus: sp.financialStatus,
            organizationId: sp.organizationId,
            unassigned: sp.unassigned
          }}
        />
      </div>
      <ManagerOrdersFilter orgs={orgs} initial={sp} statuses={statusOptions} basePath='/leader' />
      <ManagerOrdersTable rows={rows} nextCursor={nextCursor} searchParams={sp} basePath='/leader' />
      <ManagerOrdersCardList rows={rows} basePath='/leader' />
    </>
  );
}
