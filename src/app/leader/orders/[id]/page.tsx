import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { loadManagerOrderDetail } from '@/lib/services/manager/orderDetail';
import { listDirections } from '@/lib/services/training';
import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';

export default async function LeaderOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireManagerLeader();
  const { id } = await params;
  const data = await loadManagerOrderDetail(prisma, session, id);
  if (!data) notFound();

  const [directionsResult, students] = await Promise.all([
    listDirections(prisma, session),
    prisma.student.findMany({
      where: { organizationId: data.order.organizationId ?? undefined },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' }
    })
  ]);
  const directions = directionsResult.ok ? directionsResult.directions : [];

  return (
    <ManagerOrderDetailView
      data={data}
      backHref='/leader/orders'
      directions={directions}
      students={students}
    />
  );
}
