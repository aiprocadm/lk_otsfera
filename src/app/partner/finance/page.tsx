import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { isPartnerAdmin } from '@/lib/auth/policy';
import { getFinanceKpis, listStatements } from '@/lib/services/partner/finance';
import { StatCard } from '@/components/dashboard/stat-card';
import { CommissionStatementsList } from '@/components/partner/commission-statements-list';
import { ManualCalcForm } from '@/components/partner/manual-calc-form';
import { fmtMoney } from '@/lib/format';

import { PageHeader } from '@/components/ui/page-header';
export default async function FinancePage() {
  const session = await requirePartner();

  const { partnerId } = session;
  const [kpis, statements] = await Promise.all([
    getFinanceKpis(prisma, partnerId),
    listStatements(prisma, { partnerId, take: 30 }),
  ]);

  const canManage = isPartnerAdmin(session);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <PageHeader title="Финансы" subtitle="Комиссионные отчёты и выплаты" />
        </div>
        {canManage && <ManualCalcForm />}
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
        <StatCard title="Заработано" value={fmtMoney(kpis.earnedTotal)} />
        <StatCard title="В обработке" value={fmtMoney(kpis.pendingTotal)} />
        <StatCard title="Выплачено" value={fmtMoney(kpis.paidTotal)} accent />
      </div>

      <CommissionStatementsList statements={statements} canManage={canManage} />
    </div>
  );
}
