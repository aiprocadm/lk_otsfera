import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { leaderDashboard } from '@/lib/services/leader/dashboard';
import { recentEvents } from '@/lib/services/manager/dashboard';
import { StatCard } from '@/components/dashboard/stat-card';
import { fmtMoney } from '@/lib/format';
import { LeaderManagersTable } from '@/components/leader/leader-managers-table';
import { ManagerEventsFeed } from '@/components/manager/manager-events-feed';

export const dynamic = 'force-dynamic';

export default async function LeaderDashboardPage() {
  const session = await requireManagerLeader();
  const [data, events] = await Promise.all([
    leaderDashboard(prisma, session),
    // company-wide always: teamModeOverride=true (4th arg, after default `take`)
    recentEvents(prisma, session, undefined, true),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Сводка по команде</h1>
        <p className="text-sm text-gray-500 mt-0.5">Все менеджеры и заказы компании</p>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <StatCard title="Менеджеров" value={data.kpis.managers} href="/leader/team" />
        <StatCard title="Заказы в работе" value={data.kpis.activeOrders} href="/leader/orders" />
        <StatCard title="Долг клиентов" value={fmtMoney(data.kpis.debt)} href="/leader/finance" />
        <StatCard
          title="Комиссия (оценка)"
          value={data.kpis.commission === null ? '—' : fmtMoney(data.kpis.commission)}
          href="/leader/finance"
          accent
        />
      </div>
      <div className="space-y-2">
        <div>
          <h2 className="text-lg font-semibold text-[#111111]">Менеджеры команды</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Суммы — по заказам в работе у каждого менеджера; не сводятся с «Долгом клиентов» (он
            считается по выставленным к оплате заказам компании).
          </p>
        </div>
        <LeaderManagersTable rows={data.perManager} />
      </div>
      <ManagerEventsFeed events={events} />
    </div>
  );
}
