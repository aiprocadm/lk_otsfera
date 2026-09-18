import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
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
import { FunnelAnalyticsPanel } from '@/components/leader/analytics/funnel-analytics-panel';
import { ProposalConversionPanel } from '@/components/leader/analytics/proposal-conversion-panel';
import { PlanFactTable } from '@/components/leader/analytics/plan-fact-table';
import { MonthPicker } from '@/components/leader/analytics/month-picker';
import {
  AnalyticsTabs,
  isAnalyticsTab,
  type AnalyticsTabKey,
} from '@/components/leader/analytics/analytics-tabs';
import { KpiPlanFactTable } from '@/components/leader/analytics/kpi-plan-fact-table';
import { ReceivablesPanel } from '@/components/leader/analytics/receivables-panel';
import { CommunicationsPanel } from '@/components/leader/analytics/communications-panel';
import { SourcesPanel } from '@/components/leader/analytics/sources-panel';
import { PartnersAnalyticsPanel } from '@/components/leader/analytics/partners-analytics-panel';
import { PageHeader } from '@/components/ui/page-header';

/**
 * «Аналитика» руководителя (`У-243`, этап 7): пять вкладок вместо одной
 * плоской страницы. Гейт флагом `leader_analytics` — page-точка из трёх
 * (CLAUDE.md §5); под тем же флагом живёт хаб «Показатели и планы» (`Р-Э7-1`).
 *
 * Данные считаются ТОЛЬКО для открытой вкладки: считать все пять на каждый
 * показ значило бы платить за четыре отчёта, которых никто не смотрит.
 *
 * Вкладки собраны в одной функции, без вложенных async-компонентов: вложенный
 * компонент пришлось бы «разворачивать» и в тестах, и в разметке, а выигрыша
 * он не даёт — данные всё равно нужны до отрисовки.
 */
export const dynamic = 'force-dynamic';

const BASE = '/leader/analytics';

type SearchParams = Promise<{ month?: string; tab?: string; older?: string }>;

export default async function LeaderAnalyticsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  if (!isFeatureEnabled('leader_analytics')) notFound();
  const session = await requireManagerLeader();

  const sp = await searchParams;
  const { year, month } = parseKpiMonth(sp.month);
  const tab: AnalyticsTabKey = isAnalyticsTab(sp.tab) ? sp.tab : 'plan';
  const companyId = session.companyId;
  if (!companyId) notFound();

  const monthValue = `${year}-${String(month).padStart(2, '0')}`;
  const period = monthRange(year, month);
  const query = { month: monthValue };

  let content: React.ReactNode = null;

  if (tab === 'plan') {
    const [kpi, planFact] = await Promise.all([
      getKpiPlanFact(prisma, { companyId, year, month }),
      getPlanFact(prisma, session, { year, month }),
    ]);
    if (!planFact.ok) notFound();
    content = (
      <div className="space-y-6">
        <KpiPlanFactTable data={kpi} />
        <div>
          <h2 className="mb-3 text-lg font-semibold text-[#111111]">План продаж по менеджерам</h2>
          <PlanFactTable year={year} month={month} rows={planFact.rows} totals={planFact.totals} />
        </div>
      </div>
    );
  } else if (tab === 'funnel') {
    const [funnel, proposals, sources] = await Promise.all([
      getFunnelAnalytics(prisma, session, period),
      getProposalConversion(prisma, session, { year, month }),
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
      <PartnersAnalyticsPanel data={await getPartnersAnalytics(prisma, { companyId, ...period })} />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Аналитика"
        subtitle="Выполнение планов, воронка, скорость ответов, долги и партнёры — за выбранный месяц."
      />
      <MonthPicker month={monthValue} />
      <AnalyticsTabs basePath={BASE} active={tab} query={query} />
      {content}
    </div>
  );
}
