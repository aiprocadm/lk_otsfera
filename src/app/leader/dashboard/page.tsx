import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { leaderDashboard } from '@/lib/services/leader/dashboard';
import { recentEvents } from '@/lib/services/manager/dashboard';
import { StatCard } from '@/components/dashboard/stat-card';
import { QuickTasks } from '@/components/dashboard/quick-tasks';
import { quickTasksFor } from '@/lib/quickTasks';
import { fmtMoney } from '@/lib/format';
import { ManagerEventsFeed } from '@/components/manager/manager-events-feed';
import { OverdueTasksBlock } from '@/components/leader/overdue-tasks-block';
import { listOverdueTasks } from '@/lib/services/tasks/overdue';
import { isFeatureEnabled } from '@/lib/featureFlags';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function LeaderDashboardPage() {
  const session = await requireManagerLeader();
  const [data, events, overdue] = await Promise.all([
    leaderDashboard(prisma, session),
    // company-wide always: teamModeOverride=true (4th arg, after default `take`);
    // ссылки событий — в кабинет руководителя, а не менеджера (прогон №52).
    recentEvents(prisma, session, undefined, true, 'leader'),
    // `У-225`: просроченные задачи команды. Раздел задач может быть выключен —
    // тогда блока нет, иначе он вёл бы на недоступный экран.
    isFeatureEnabled('internal_tasks')
      ? listOverdueTasks(prisma, session)
      : Promise.resolve({ rows: [], total: 0 }),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="Главная" subtitle="Все менеджеры и заказы компании" />
      </div>

      <QuickTasks tasks={quickTasksFor('leader')} />
      {isFeatureEnabled('internal_tasks') && (
        <OverdueTasksBlock rows={overdue.rows} total={overdue.total} href="/leader/tasks" />
      )}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {/* `У-345`: вместо «Менеджеров» (дубль «Посмотреть результаты команды») —
            оплаты по команде за месяц; та же цифра, что «Оплачено» в аналитике. */}
        <StatCard
          title="Оплачено по команде"
          value={fmtMoney(data.kpis.paidThisMonth)}
          hint="за этот месяц, все менеджеры"
          href={
            isFeatureEnabled('leader_analytics') ? '/leader/analytics?tab=plan' : '/leader/team'
          }
        />
        <StatCard title="Заказы в работе" value={data.kpis.activeOrders} href="/leader/orders" />
        <StatCard
          title="Долг клиентов"
          value={fmtMoney(data.kpis.debt)}
          hintLink="Отдельно по организациям"
          href="/leader/finance"
        />
        <StatCard
          title="Комиссия посредников"
          value={data.kpis.commission === null ? '—' : fmtMoney(data.kpis.commission)}
          hint={
            data.kpis.commission === null
              ? 'у организаций нет посредников с комиссией'
              : `к выплате · выплачено в этом месяце: ${fmtMoney(data.kpis.commissionPaidThisMonth)}`
          }
          href="/leader/finance"
          accent
        />
      </div>
      <ManagerEventsFeed events={events} />
    </div>
  );
}
