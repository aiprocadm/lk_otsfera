import { StatCard } from '@/components/dashboard/stat-card';
import { fmtMoney } from '@/lib/format';
import type { OrgDashboardKpis } from '@/lib/services/organization/dashboard';

export function OrgKpiGrid({ kpis }: { kpis: OrgDashboardKpis }) {
  return (
    <div className='grid gap-3 grid-cols-2 md:grid-cols-4'>
      <StatCard title='Активных заказов' value={kpis.activeOrders} href='/organization/orders' />
      <StatCard title='К оплате' value={fmtMoney(kpis.outstandingAmount)} accent href='/organization/finance' />
      <StatCard title='Сотрудников на курсе' value={kpis.studentsCount} href='/organization/students' />
      <StatCard title='Документов за 30 дней' value={kpis.recentDocumentsCount} href='/organization/documents' />
    </div>
  );
}
