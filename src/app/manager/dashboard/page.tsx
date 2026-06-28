import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import {
  kpis,
  attention,
  recentEvents
} from '@/lib/services/manager/dashboard';
import { ManagerKpiGrid } from '@/components/manager/manager-kpi-grid';
import { ManagerAttentionList } from '@/components/manager/manager-attention-list';
import { ManagerEventsFeed } from '@/components/manager/manager-events-feed';

export default async function ManagerDashboard() {
  const session = await requireManager();
  const [kpiData, attentionData, events] = await Promise.all([
    kpis(prisma, session),
    attention(prisma, session),
    recentEvents(prisma, session)
  ]);
  return (
    <>
      <h1 className='mb-4 text-2xl font-semibold'>Главная</h1>
      <div className='space-y-4'>
        <ManagerKpiGrid data={kpiData} />
        <ManagerAttentionList items={attentionData} />
        <ManagerEventsFeed events={events} />
      </div>
    </>
  );
}
