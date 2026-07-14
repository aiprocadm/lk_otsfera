import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { loadManagerOrderDetail } from '@/lib/services/manager/orderDetail';
import { getDealActivity } from '@/lib/services/manager/dealActivity';
import { listDirections } from '@/lib/services/training';
import { getValuesForEntity } from '@/lib/services/customFields';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';

export default async function LeaderOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireManagerLeader();
  const { id } = await params;
  const data = await loadManagerOrderDetail(prisma, session, id);
  if (!data) notFound();

  const [directionsResult, students, customFieldsResult, activity] = await Promise.all([
    listDirections(prisma, session),
    prisma.student.findMany({
      where: { organizationId: data.order.organizationId ?? undefined },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' }
    }),
    getValuesForEntity(prisma, 'order', id),
    getDealActivity(prisma, session, id, { view: 'all' })
  ]);
  const directions = directionsResult.ok ? directionsResult.directions : [];
  const customFields = customFieldsResult.ok ? customFieldsResult.fields : [];
  const activityItems = activity.ok ? activity.items : [];
  const inboundEnabled = isFeatureEnabled('inbound_messaging');
  const telephonyEnabled = isFeatureEnabled('telephony_mango');

  return (
    <ManagerOrderDetailView
      data={data}
      backHref='/leader/orders'
      directions={directions}
      students={students}
      customFields={customFields}
      activityItems={activityItems}
      inboundEnabled={inboundEnabled}
      telephonyEnabled={telephonyEnabled}
    />
  );
}
