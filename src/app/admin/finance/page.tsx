import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';

export const dynamic = 'force-dynamic';

export default async function AdminFinancePage() {
  const session = await requireAdmin();
  // admin → unscoped внутри сервиса (session.role==='admin'); teamMode игнорируется.
  const data = await getManagerFinanceOverview(prisma, session, { teamMode: false });
  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-semibold text-[#111111]'>Финансы</h1>
        <p className='text-sm text-gray-500 mt-0.5'>Оплаты по всем организациям</p>
      </div>
      <ManagerFinanceView data={data} ordersBasePath='/admin' />
    </div>
  );
}
