import React from 'react';
import { OrgFinanceKpisGrid } from '@/components/organization/org-finance-kpis';
import { OrgFinanceCommission } from '@/components/manager/org-finance-commission';
import type { ManagerFinanceOverview } from '@/lib/services/manager/finance';
import { fmtMoney } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { ManagerFinancePayments } from './manager-finance-payments';

export function ManagerFinanceView({
  data,
  ordersBasePath = '/manager',
}: {
  data: ManagerFinanceOverview;
  ordersBasePath?: string;
}) {
  if (data.sections.length === 0) {
    // `У-74`/`У-175`: пустой экран объясняет, почему пусто и к кому идти.
    // Кнопки нет намеренно — назначить организации может только администратор.
    return (
      <EmptyState
        title="Нет организаций в вашей зоне видимости"
        message="Финансы показываются по организациям, которые за вами закреплены. Обратитесь к администратору, чтобы вам назначили организации."
      />
    );
  }
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
          Итого по всем организациям
        </h2>
        <OrgFinanceKpisGrid kpis={data.summary} />
      </section>

      {data.sections.map((s) => (
        <section key={s.orgId} className="space-y-3">
          <div className="flex items-baseline justify-between gap-3 border-b border-gray-100 pb-2">
            <h3 className="text-lg font-semibold text-[#111111]">{s.orgName}</h3>
            <span className="text-xs text-gray-500">
              Выставлено {fmtMoney(s.kpis.billed)} · Оплачено {fmtMoney(s.kpis.paid)} · Долг{' '}
              {fmtMoney(s.kpis.outstanding)}
            </span>
          </div>
          {s.commission && <OrgFinanceCommission data={s.commission} />}
          <ManagerFinancePayments payments={s.payments} basePath={ordersBasePath} />
        </section>
      ))}
    </div>
  );
}
