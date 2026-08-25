import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function ManagerFinancePage() {
  const session = await requireManager();
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const data = await getManagerFinanceOverview(prisma, session, { teamMode });
  return (
    <div className="space-y-6">
      <div>
        <PageHeader title="Финансы" subtitle="Оплаты по вашим организациям" />
      </div>
      <ManagerFinanceView data={data} ordersBasePath="/manager" />
    </div>
  );
}
