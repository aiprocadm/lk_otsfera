import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { prisma } from '@/lib/db/prisma';
import { kpis, attention, recentEvents } from '@/lib/services/manager/dashboard';
import { getMyDay } from '@/lib/services/manager/myDay';
import { MyDayCards } from '@/components/manager/my-day-cards';
import { QuickTasks } from '@/components/dashboard/quick-tasks';
import { quickTasksFor } from '@/lib/quickTasks';
import { ManagerKpiGrid } from '@/components/manager/manager-kpi-grid';
import { ManagerAttentionList } from '@/components/manager/manager-attention-list';
import { ManagerEventsFeed } from '@/components/manager/manager-events-feed';

import { PageHeader } from '@/components/ui/page-header';
export default async function ManagerDashboard() {
  const session = await requireManager();
  // Один свежий рид флага на запрос вместо трёх одинаковых внутри сервисов
  // (семантика C8 сохранена: флаг читается свежим в рамках этого же запроса).
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const [kpiData, attentionData, events, myDay] = await Promise.all([
    kpis(prisma, session, teamMode),
    attention(prisma, session, teamMode),
    // undefined take → дефолт сервиса; 4-й аргумент — общий teamMode
    recentEvents(prisma, session, undefined, teamMode),
    // Этап 11 PR-2 (ФТ-15.3): «Мой день» — первый блок «Главной».
    getMyDay(prisma, session, teamMode),
  ]);
  return (
    <>
      <div className="mb-4">
        <PageHeader
          title="Главная"
          subtitle="Что требует внимания прямо сейчас и с чего начать день"
        />
      </div>
      <div className="space-y-4">
        <QuickTasks tasks={quickTasksFor('manager')} />
        <MyDayCards data={myDay} />
        <ManagerKpiGrid data={kpiData} />
        <ManagerAttentionList items={attentionData} />
        <ManagerEventsFeed events={events} />
      </div>
    </>
  );
}
