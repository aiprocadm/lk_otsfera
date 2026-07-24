import React from 'react';
import { StatCard } from '@/components/dashboard/stat-card';
import { fmtMoney } from '@/lib/format';

export type DashboardKpis = {
  openOrders: number;
  outstanding: string;
  activeLeads: number;
  commissionThisMonth: string;
};

export function KpiGrid({
  kpis,
  expiringCertificates = null
}: {
  kpis: DashboardKpis;
  /** Этап 3 (ФТ-6.4): счётчик «Истекают удостоверения»; null — флаг реестров выключен, карточки нет. */
  expiringCertificates?: number | null;
}) {
  return (
    <div className='grid gap-3 grid-cols-2 md:grid-cols-4'>
      <StatCard title='Открытые заказы' value={kpis.openOrders} href='/partner/deals' />
      <StatCard title='К оплате' value={fmtMoney(kpis.outstanding)} href='/partner/finance' />
      <StatCard title='Заявки в работе' value={kpis.activeLeads} href='/partner/leads' />
      <StatCard title='Комиссия за месяц' value={fmtMoney(kpis.commissionThisMonth)} accent href='/partner/finance' />
      {expiringCertificates !== null && (
        <StatCard
          title='Истекают удостоверения'
          value={expiringCertificates}
          accent={expiringCertificates > 0}
          href='/partner/certificates?status=expiring'
        />
      )}
    </div>
  );
}
