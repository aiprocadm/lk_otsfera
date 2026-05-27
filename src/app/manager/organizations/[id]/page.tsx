import { notFound } from 'next/navigation';
import { requireManagerForOrg } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getOrganization } from '@/lib/services/manager/organizations';
import { listOrders } from '@/lib/services/manager/orders';
import { ManagerOrgCard } from '@/components/manager/manager-org-card';
import { ManagerOrdersTable } from '@/components/manager/manager-orders-table';

export default async function ManagerOrgDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireManagerForOrg(id);
  const [org, { rows: recentOrders }] = await Promise.all([
    getOrganization(prisma, session, id),
    listOrders(prisma, { session, organizationId: id, take: 10 })
  ]);
  if (!org) notFound();
  return (
    <div className='space-y-4'>
      <ManagerOrgCard org={org} />
      <div>
        <h2 className='mt-2 mb-2 text-xl font-semibold text-[#111111]'>Последние заказы</h2>
        <ManagerOrdersTable rows={recentOrders} nextCursor={null} searchParams={{}} />
      </div>
    </div>
  );
}
