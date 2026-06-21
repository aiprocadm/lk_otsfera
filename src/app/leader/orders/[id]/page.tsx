import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { loadManagerOrderDetail } from '@/lib/services/manager/orderDetail';
import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';

export default async function LeaderOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireManagerLeader();
  const { id } = await params;
  const data = await loadManagerOrderDetail(prisma, session, id);
  if (!data) notFound();
  return <ManagerOrderDetailView data={data} backHref='/leader/orders' />;
}
