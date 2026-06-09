import React from 'react';
import { OrgFinanceKpisGrid } from '@/components/organization/org-finance-kpis';
import { OrgFinanceCommission } from '@/components/organization/org-finance-commission';
import { ManagerFinancePayments } from './manager-finance-payments';
import type { ManagerFinanceOverview } from '@/lib/services/manager/finance';

function fmtMoney(val: string): string {
  const n = Number(val);
  return (isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)) + ' ₽';
}

export function ManagerFinanceView({ data }: { data: ManagerFinanceOverview }) {
  if (data.sections.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <p className='text-gray-500 text-sm'>Нет организаций в вашей зоне видимости.</p>
      </div>
    );
  }
  return (
    <div className='space-y-8'>
      <section className='space-y-3'>
        <h2 className='text-sm font-medium text-gray-500 uppercase tracking-wider'>Итого по всем организациям</h2>
        <OrgFinanceKpisGrid kpis={data.summary} />
      </section>

      {data.sections.map((s) => (
        <section key={s.orgId} className='space-y-3'>
          <div className='flex items-baseline justify-between gap-3 border-b border-gray-100 pb-2'>
            <h3 className='text-lg font-semibold text-[#111111]'>{s.orgName}</h3>
            <span className='text-xs text-gray-500'>
              Выставлено {fmtMoney(s.kpis.billed)} · Оплачено {fmtMoney(s.kpis.paid)} · Долг {fmtMoney(s.kpis.outstanding)}
            </span>
          </div>
          {s.commission && <OrgFinanceCommission data={s.commission} />}
          <ManagerFinancePayments payments={s.payments} />
        </section>
      ))}
    </div>
  );
}
