import React from 'react';
import { StatCard } from '@/components/dashboard/stat-card';
import { fmtMoney } from '@/lib/format';

export type DashboardKpis = {
  openOrders: number;
  outstanding: string;
  activeLeads: number;
  commissionThisMonth: string;
};

export function KpiGrid({ kpis }: { kpis: DashboardKpis }) {
  return (
    <div className='grid gap-3 grid-cols-2 md:grid-cols-4'>
      <StatCard title='Открытые заказы' value={kpis.openOrders} href='/partner/deals' />
      <StatCard title='К оплате' value={fmtMoney(kpis.outstanding)} href='/partner/finance' />
      <StatCard title='Заявки в работе' value={kpis.activeLeads} href='/partner/leads' />
      <StatCard title='Комиссия за месяц' value={fmtMoney(kpis.commissionThisMonth)} accent href='/partner/finance' />
    </div>
  );
}
