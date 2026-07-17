import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrders } from '@/lib/services/manager/orders';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { ManagerOrdersFilter } from '@/components/manager/manager-orders-filter';
import { ManagerOrdersTable } from '@/components/manager/manager-orders-table';
import { ManagerOrdersCardList } from '@/components/manager/manager-orders-card-list';

type SearchParams = {
  search?: string;
  executionStatus?: string;
  financialStatus?: string;
  organizationId?: string;
  unassigned?: string;
  cursor?: string;
};

export default async function ManagerOrdersPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const [{ rows, nextCursor }, orgs] = await Promise.all([
    listOrders(prisma, { session, ...sp, unassigned: sp.unassigned === '1' }),
    listOrganizations(prisma, session)
  ]);
  return (
    <>
      <div className='mb-4'>
        <h1 className='text-2xl font-semibold text-[#111111]'>Заказы</h1>
        <p className='text-sm text-gray-500 mt-0.5'>Заказы ваших организаций</p>
      </div>
      <ManagerOrdersFilter orgs={orgs} initial={sp} />
      <ManagerOrdersTable rows={rows} nextCursor={nextCursor} searchParams={sp} />
      <ManagerOrdersCardList rows={rows} />
    </>
  );
}