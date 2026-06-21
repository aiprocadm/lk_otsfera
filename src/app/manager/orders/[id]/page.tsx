import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { loadManagerOrderDetail } from '@/lib/services/manager/orderDetail';
import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';

export default async function ManagerOrderDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireManager();
  const { id } = await params;
  const data = await loadManagerOrderDetail(prisma, session, id);
  if (!data) notFound();
  return <ManagerOrderDetailView data={data} backHref='/manager/orders' />;
}
