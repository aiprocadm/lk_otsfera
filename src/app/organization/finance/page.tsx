import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgFinanceKpisGrid } from '@/components/organization/org-finance-kpis';
import { OrgFinancePayments } from '@/components/organization/org-finance-payments';
import {
  getOrgFinanceKpis,
  listOrgPayments
} from '@/lib/services/organization/finance';

export default async function OrganizationFinancePage({
  searchParams
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

  const [kpis, payments] = await Promise.all([
    getOrgFinanceKpis(prisma, ctx.activeOrgId),
    listOrgPayments(prisma, { organizationId: ctx.activeOrgId })
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
          <p className='text-sm text-gray-500 mt-0.5'>Платежи и задолженность по {ctx.activeOrgName}</p>
        </div>
        <OrgFinanceKpisGrid kpis={kpis} />
        <OrgFinancePayments payments={payments} orgId={ctx.activeOrgId} />
      </div>
    </OrgAppShell>
  );
}
