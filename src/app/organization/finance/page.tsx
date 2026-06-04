import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgFinanceKpisGrid } from '@/components/organization/org-finance-kpis';
import { OrgFinancePayments } from '@/components/organization/org-finance-payments';
import { OrgFinanceCommission } from '@/components/organization/org-finance-commission';
import {
  getOrgFinanceKpis,
  listOrgPayments,
  getOrgIntermediaryCommission
} from '@/lib/services/organization/finance';

export default async function OrganizationFinancePage({
  searchParams
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);
  const canSeeCommission = ctx.viewerRole === 'admin' || ctx.viewerRole === 'leader';

  const [kpis, payments, commission] = await Promise.all([
    getOrgFinanceKpis(prisma, ctx.activeOrgId),
    listOrgPayments(prisma, { organizationId: ctx.activeOrgId }),
    canSeeCommission ? getOrgIntermediaryCommission(prisma, ctx.activeOrgId) : Promise.resolve(null)
  ]);

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className='space-y-6'>
        <div>
          <h1 className='text-2xl font-semibold text-[#111111]'>Финансы</h1>
          <p className='text-sm text-gray-500 mt-1'>Платежи и задолженность по «{ctx.activeOrgName}»</p>
        </div>
        <OrgFinanceKpisGrid kpis={kpis} />
        {commission && <OrgFinanceCommission data={commission} />}
        <OrgFinancePayments payments={payments} />
      </div>
    </OrgAppShell>
  );
}
