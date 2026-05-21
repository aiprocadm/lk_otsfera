import { StatCard } from '@/components/dashboard/stat-card';

export type DashboardKpis = {
  openOrders: number;
  outstanding: string;
  activeLeads: number;
  commissionThisMonth: string;
};

function fmtMoney(rubles: string): string {
  const n = Number(rubles);
  if (!Number.isFinite(n)) return rubles;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽';
}

export function KpiGrid({ kpis }: { kpis: DashboardKpis }) {
  return (
    <div className='grid gap-3 grid-cols-2 md:grid-cols-4'>
      <StatCard title='Открытые сделки' value={kpis.openOrders} />
      <StatCard title='К оплате' value={fmtMoney(kpis.outstanding)} />
      <StatCard title='Заявки в работе' value={kpis.activeLeads} />
      <StatCard title='Комиссия за месяц' value={fmtMoney(kpis.commissionThisMonth)} accent />
    </div>
  );
}
