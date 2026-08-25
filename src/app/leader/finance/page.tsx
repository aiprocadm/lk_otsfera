import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function LeaderFinancePage() {
  const session = await requireManagerLeader();
  const data = await getManagerFinanceOverview(prisma, session, { teamMode: true });
  return (
    <div className="space-y-6">
      <div>
        <PageHeader title="Финансы" subtitle="Оплаты и комиссия по всем организациям компании" />
      </div>
      <ManagerFinanceView data={data} ordersBasePath="/leader" />
    </div>
  );
}
