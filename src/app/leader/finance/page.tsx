import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';

export const dynamic = 'force-dynamic';

export default async function LeaderFinancePage() {
  const session = await requireManagerLeader();
  const data = await getManagerFinanceOverview(prisma, session, { teamMode: true });
  return (
    <>
      <h1 className='mb-1 text-2xl font-semibold text-[#111111]'>Финансы</h1>
      <p className='text-sm text-gray-500 mb-6'>Оплаты и комиссия по всем организациям компании</p>
      <ManagerFinanceView data={data} />
    </>
  );
}
