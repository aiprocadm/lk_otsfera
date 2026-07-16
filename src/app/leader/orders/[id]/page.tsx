import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { loadManagerOrderDetail } from '@/lib/services/manager/orderDetail';
import { getDealActivity } from '@/lib/services/manager/dealActivity';
import { listDirections } from '@/lib/services/training';
import { getValuesForEntity } from '@/lib/services/customFields';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { ManagerOrderDetailView } from '@/components/manager/manager-order-detail-view';
import { LeaderAssignOrderManagerForm } from '@/components/leader/leader-assign-order-manager-form';

export default async function LeaderOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireManagerLeader();
  const { id } = await params;
  const data = await loadManagerOrderDetail(prisma, session, id);
  if (!data) notFound();

  const [directionsResult, students, customFieldsResult, activity, companyManagers] = await Promise.all([
    listDirections(prisma, session),
    prisma.student.findMany({
      where: { organizationId: data.order.organizationId ?? undefined },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' }
    }),
    getValuesForEntity(prisma, 'order', id),
    getDealActivity(prisma, session, id, { view: 'all' }),
    // A3: кандидаты для формы назначения — активные менеджеры компании
    // руководителя (C8: граница — компания; без companyId кандидатов нет).
    session.companyId ? listCompanyManagers(prisma, session.companyId) : Promise.resolve([])
  ]);
  const directions = directionsResult.ok ? directionsResult.directions : [];
  const customFields = customFieldsResult.ok ? customFieldsResult.fields : [];
  const activityItems = activity.ok ? activity.items : [];
  const inboundEnabled = isFeatureEnabled('inbound_messaging');
  const telephonyEnabled = isFeatureEnabled('telephony_mango');
  const candidates = companyManagers
    .filter((m) => m.isActive)
    .map((m) => ({ id: m.id, email: m.email, name: m.name }));

  return (
    <div className='space-y-5'>
      {/* Форма назначения — leader-only, поэтому монтируется рядом с общей
          деталкой, а не внутри ManagerOrderDetailView (§4 sibling-rule). */}
      <LeaderAssignOrderManagerForm
        orderId={data.order.id}
        currentManagerId={data.order.managerId}
        candidates={candidates}
      />
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
    </div>
  );
}
