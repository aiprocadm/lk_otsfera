import { StatCard } from '@/components/dashboard/stat-card';
import type { OrgFinanceKpis } from '@/lib/services/organization/finance';

function fmtMoney(val: string): string {
  const n = Number(val);
  return (isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)) + ' ₽';
}

export function OrgFinanceKpisGrid({ kpis }: { kpis: OrgFinanceKpis }) {
  return (
    <div className='grid gap-3 grid-cols-2 md:grid-cols-3'>
      <StatCard title='Выставлено' value={fmtMoney(kpis.billed)} />
      <StatCard title='Оплачено' value={fmtMoney(kpis.paid)} />
      <StatCard title='Задолженность' value={fmtMoney(kpis.outstanding)} accent />
    </div>
  );
}
