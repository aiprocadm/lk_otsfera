import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrders } from '@/lib/services/manager/orders';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { ManagerOrdersFilter } from '@/components/manager/manager-orders-filter';
import { ManagerOrdersTable } from '@/components/manager/manager-orders-table';
import { ManagerOrdersCardList } from '@/components/manager/manager-orders-card-list';

export const dynamic = 'force-dynamic';

type SearchParams = {
  search?: string;
  executionStatus?: string;
  financialStatus?: string;
  organizationId?: string;
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
    listOrders(prisma, { session, ...sp, teamModeOverride: true }),
    listOrganizations(prisma, session, true)
  ]);
  return (
    <>
      <h1 className='mb-1 text-2xl font-semibold text-[#111111]'>Заказы</h1>
      <p className='text-sm text-gray-500 mb-4'>Все заказы компании</p>
      <ManagerOrdersFilter orgs={orgs} initial={sp} basePath='/leader' />
      <ManagerOrdersTable rows={rows} nextCursor={nextCursor} searchParams={sp} basePath='/leader' />
      <ManagerOrdersCardList rows={rows} basePath='/leader' />
    </>
  );
}
