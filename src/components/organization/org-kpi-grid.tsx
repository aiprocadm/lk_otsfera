import { StatCard } from '@/components/dashboard/stat-card';

export type OrgDashboardKpis = {
  activeOrders: number;
  outstandingAmount: string;
  studentsCount: number;
  recentDocumentsCount: number;
};

function fmtMoney(rubles: string): string {
  const n = Number(rubles);
  if (!Number.isFinite(n)) return rubles;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n) + ' ₽';
}

export function OrgKpiGrid({ kpis }: { kpis: OrgDashboardKpis }) {
  return (
    <div className='grid gap-3 grid-cols-2 md:grid-cols-4'>
      <StatCard title='Активных заказов' value={kpis.activeOrders} />
      <StatCard title='К оплате' value={fmtMoney(kpis.outstandingAmount)} accent />
      <StatCard title='Сотрудников на курсе' value={kpis.studentsCount} />
      <StatCard title='Документов за 30 дней' value={kpis.recentDocumentsCount} />
    </div>
  );
}
