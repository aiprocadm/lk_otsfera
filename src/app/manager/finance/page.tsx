import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';

export const dynamic = 'force-dynamic';

export default async function ManagerFinancePage() {
  const session = await requireManager();
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const data = await getManagerFinanceOverview(prisma, session, { teamMode });
  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-semibold text-[#111111]'>Финансы</h1>
        <p className='text-sm text-gray-500 mt-0.5'>Оплаты по вашим организациям</p>
      </div>
      <ManagerFinanceView data={data} ordersBasePath='/manager' />
    </div>
  );
}
