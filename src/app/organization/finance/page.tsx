import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgFinanceKpisGrid } from '@/components/organization/org-finance-kpis';
import { OrgFinancePayments } from '@/components/organization/org-finance-payments';
import { ExportLink } from '@/components/ui';
import { getOrgFinanceKpis, listOrgPayments } from '@/lib/services/organization/finance';
import {
  listOrgInvoices,
  parseInvoiceDate,
  parseInvoiceState,
} from '@/lib/services/organization/invoices';
import { OrgFinanceInvoices } from '@/components/organization/org-finance-invoices';
import { orgOrderScope } from '@/lib/services/organization/memberScope';

import { PageHeader } from '@/components/ui/page-header';
export default async function OrganizationFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; from?: string; to?: string; state?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

  // `У-235`: фильтры счетов — из адреса; мусор в параметрах = «без фильтра».
  const invoiceFilter = {
    from: parseInvoiceDate(sp.from, 'from'),
    to: parseInvoiceDate(sp.to, 'to'),
    state: parseInvoiceState(sp.state),
  };
  // `У-236`: деньги показывают номера и суммы заказов, поэтому граница
  // видимости участника действует и на «Финансах», и на выгрузке.
  const scope = await orgOrderScope(prisma, ctx.session, ctx.activeOrgId);
  const [kpis, payments, invoices] = await Promise.all([
    getOrgFinanceKpis(prisma, ctx.activeOrgId, scope),
    listOrgPayments(prisma, { organizationId: ctx.activeOrgId, scope }),
    listOrgInvoices(prisma, { organizationId: ctx.activeOrgId, ...invoiceFilter, scope }),
  ]);

  return (
    <OrgAppShell
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <PageHeader
              title="Финансы"
              subtitle={<>Счета, платежи и задолженность по {ctx.activeOrgName}</>}
            />
          </div>
          {/* ФТ-12.2: платежи и задолженность в Excel (лист «Итоги» — KPI). */}
          <ExportLink base="/api/organization/finance/export" params={{ org: ctx.activeOrgId }} />
        </div>
        <OrgFinanceKpisGrid kpis={kpis} />
        <OrgFinanceInvoices
          result={invoices}
          orgId={ctx.activeOrgId}
          filter={{
            from: invoiceFilter.from ? sp.from : undefined,
            to: invoiceFilter.to ? sp.to : undefined,
            state: invoiceFilter.state,
          }}
        />
        <OrgFinancePayments payments={payments} orgId={ctx.activeOrgId} />
      </div>
    </OrgAppShell>
  );
}
