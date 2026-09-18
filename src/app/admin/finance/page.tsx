import React from 'react';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { ManagerFinanceView } from '@/components/manager/manager-finance-view';
import {
  getFunnelAnalytics,
  getPlanFact,
  getProposalConversion,
  monthRange,
} from '@/lib/services/leader/analytics';
import { getKpiPlanFact } from '@/lib/kpi/plan';
import { getReceivables } from '@/lib/services/leader/receivables';
import { getCommunications } from '@/lib/services/leader/communications';
import { getSources } from '@/lib/services/leader/sources';
import { getPartnersAnalytics } from '@/lib/services/leader/partnersAnalytics';
import { parseKpiMonth } from '@/lib/kpi/period';
import {
  AnalyticsTabs,
  isAnalyticsTab,
  type AnalyticsTabKey,
} from '@/components/leader/analytics/analytics-tabs';
import { KpiPlanFactTable } from '@/components/leader/analytics/kpi-plan-fact-table';
import { FunnelAnalyticsPanel } from '@/components/leader/analytics/funnel-analytics-panel';
import { ProposalConversionPanel } from '@/components/leader/analytics/proposal-conversion-panel';
import { PlanFactTable } from '@/components/leader/analytics/plan-fact-table';
import { ReceivablesPanel } from '@/components/leader/analytics/receivables-panel';
import { CommunicationsPanel } from '@/components/leader/analytics/communications-panel';
import { SourcesPanel } from '@/components/leader/analytics/sources-panel';
import { PartnersAnalyticsPanel } from '@/components/leader/analytics/partners-analytics-panel';
import { CompanyPicker } from '@/components/leader/analytics/company-picker';
import { MonthPicker } from '@/components/leader/analytics/month-picker';
import { PageHeader } from '@/components/ui/page-header';

/**
 * «Финансы» администратора (`У-243`, решение `Р-Э7-8`).
 *
 * Те же пять вкладок аналитики, что у руководителя, — набор, порядок и названия
 * берутся из одного словаря (правило зеркала §0.2). Отличие одно: администратор
 * выбирает компанию, руководителю она достаётся из сессии.
 *
 * Прежний блок «Оплаты по всем организациям» остаётся сверху: он про все
 * компании сразу, и ни в одну вкладку по компании не помещается.
 */
export const dynamic = 'force-dynamic';

const BASE = '/admin/finance';

type SearchParams = Promise<{
  company?: string;
  month?: string;
  tab?: string;
  older?: string;
}>;

export default async function AdminFinancePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireAdmin();
  const sp = await searchParams;

  // admin → unscoped внутри сервиса (session.role==='admin'); teamMode игнорируется.
  const overview = await getManagerFinanceOverview(prisma, session, { teamMode: false });

  const analyticsOn = isFeatureEnabled('leader_analytics');
  const companies = analyticsOn
    ? await prisma.company.findMany({
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      })
    : [];
  const requested = typeof sp.company === 'string' ? sp.company : '';
  const companyId = companies.find((c) => c.id === requested)?.id ?? companies[0]?.id ?? null;

  const { year, month } = parseKpiMonth(sp.month);
  const tab: AnalyticsTabKey = isAnalyticsTab(sp.tab) ? sp.tab : 'plan';
  const monthValue = `${year}-${String(month).padStart(2, '0')}`;
  const period = monthRange(year, month);
  const query = companyId ? { company: companyId, month: monthValue } : { month: monthValue };

  let content: React.ReactNode = null;
  if (analyticsOn && companyId) {
    if (tab === 'plan') {
      const [kpi, planFact] = await Promise.all([
        getKpiPlanFact(prisma, { companyId, year, month }),
        getPlanFact(prisma, { ...session, companyId }, { year, month }),
      ]);
      if (!planFact.ok) notFound();
      content = (
        <div className="space-y-6">
          <KpiPlanFactTable data={kpi} />
          <div>
            <h2 className="mb-3 text-lg font-semibold text-[#111111]">План продаж по менеджерам</h2>
            <PlanFactTable
              year={year}
              month={month}
              rows={planFact.rows}
              totals={planFact.totals}
            />
          </div>
        </div>
      );
    } else if (tab === 'funnel') {
      const scoped = { ...session, companyId };
      const [funnel, proposals, sources] = await Promise.all([
        getFunnelAnalytics(prisma, scoped, period),
        getProposalConversion(prisma, scoped, { year, month }),
        getSources(prisma, { companyId, ...period }),
      ]);
      if (!funnel.ok || !proposals.ok) notFound();
      content = (
        <div className="space-y-6">
          <FunnelAnalyticsPanel
            snapshot={funnel.snapshot}
            cohort={funnel.cohort}
            perManager={funnel.perManager}
          />
          <ProposalConversionPanel conversion={proposals.conversion} />
          <SourcesPanel data={sources} />
        </div>
      );
    } else if (tab === 'communications') {
      content = (
        <CommunicationsPanel data={await getCommunications(prisma, { companyId, ...period })} />
      );
    } else if (tab === 'receivables') {
      const data = await getReceivables(prisma, {
        companyId,
        olderThanDays: Number(sp.older) || 0,
      });
      content = <ReceivablesPanel data={data} basePath={BASE} query={query} />;
    } else {
      content = (
        <PartnersAnalyticsPanel
          data={await getPartnersAnalytics(prisma, { companyId, ...period })}
        />
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Финансы" subtitle="Оплаты по всем организациям и аналитика по компании" />

      <ManagerFinanceView data={overview} ordersBasePath="/admin" />

      {analyticsOn && companyId && (
        <section className="space-y-4" data-testid="admin-analytics">
          <h2 className="text-lg font-semibold text-[#111111]">Аналитика по компании</h2>
          <div className="flex flex-wrap items-center gap-3">
            <CompanyPicker
              basePath={BASE}
              companies={companies}
              active={companyId}
              query={{ month: monthValue, tab }}
            />
            <MonthPicker month={monthValue} />
          </div>
          <AnalyticsTabs basePath={BASE} active={tab} query={query} />
          {content}
        </section>
      )}
    </div>
  );
}
