import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';

export const dynamic = 'force-dynamic';

export default async function LeaderFinancePage() {
  const session = await requireManagerLeader();
  const data = await getManagerFinanceOverview(prisma, session, { teamMode: true });
  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-semibold text-[#111111]'>Финансы</h1>
        <p className='text-sm text-gray-500 mt-0.5'>Оплаты и комиссия по всем организациям компании</p>
      </div>
      <ManagerFinanceView data={data} ordersBasePath='/leader' />
    </div>
  );
}
