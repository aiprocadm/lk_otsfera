import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrders } from '@/lib/services/manager/orders';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { ManagerOrdersFilter } from '@/components/manager/manager-orders-filter';
import { ManagerOrdersTable } from '@/components/manager/manager-orders-table';

type SearchParams = {
  q?: string;
  executionStatus?: string;
  financialStatus?: string;
  organizationId?: string;
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
    listOrders(prisma, { session, ...sp }),
    listOrganizations(prisma, session)
  ]);
  return (
    <>
      <h1 className='mb-4 text-2xl font-semibold'>Заказы</h1>
      <ManagerOrdersFilter orgs={orgs} initial={sp} />
      <ManagerOrdersTable rows={rows} nextCursor={nextCursor} searchParams={sp} />
    </>
  );
}
