import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
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
  // Один свежий рид флага на запрос вместо трёх одинаковых внутри сервисов
  // (семантика C8 сохранена: флаг читается свежим в рамках этого же запроса).
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const [kpiData, attentionData, events] = await Promise.all([
    kpis(prisma, session, teamMode),
    attention(prisma, session, teamMode),
    // undefined take → дефолт сервиса; 4-й аргумент — общий teamMode
    recentEvents(prisma, session, undefined, teamMode)
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