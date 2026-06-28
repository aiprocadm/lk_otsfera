import React from 'react';
import { StatCard } from '@/components/dashboard/stat-card';
import type { OrgFinanceKpis } from '@/lib/services/organization/finance';
import { fmtMoney } from '@/lib/format';

export function OrgFinanceKpisGrid({ kpis }: { kpis: OrgFinanceKpis }) {
  return (
    <div className='grid gap-3 grid-cols-2 md:grid-cols-3'>
      <StatCard title='Выставлено' value={fmtMoney(kpis.billed)} />
      <StatCard title='Оплачено' value={fmtMoney(kpis.paid)} />
      <StatCard title='Задолженность' value={fmtMoney(kpis.outstanding)} accent />
    </div>
  );
}
