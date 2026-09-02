import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import {
  getFunnelAnalytics,
  getPlanFact,
  getProposalConversion,
  monthRange,
} from '@/lib/services/leader/analytics';
import { MonthPicker } from '@/components/leader/analytics/month-picker';
import { FunnelAnalyticsPanel } from '@/components/leader/analytics/funnel-analytics-panel';
import { PlanFactTable } from '@/components/leader/analytics/plan-fact-table';
import { ProposalConversionPanel } from '@/components/leader/analytics/proposal-conversion-panel';

import { PageHeader } from '@/components/ui/page-header';
/**
 * M3 (Task 3) — /leader/analytics: когортная конверсия воронки + план/факт
 * продаж по менеджерам за месяц. Гейт флагом `leader_analytics` (page-точка
 * из трёх, см. CLAUDE.md §5); middleware/nav-точки уже на месте (Task 1-2).
 */

export const dynamic = 'force-dynamic';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function parsePeriod(raw: string | undefined): { year: number; month: number } {
  if (!raw || !MONTH_RE.test(raw)) return currentPeriod();
  const [year, month] = raw.split('-').map(Number);
  return { year: year!, month: month! };
}

type SearchParams = Promise<{ month?: string }>;

export default async function LeaderAnalyticsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  if (!isFeatureEnabled('leader_analytics')) notFound();
  const session = await requireManagerLeader();

  const sp = await searchParams;
  const { year, month } = parsePeriod(sp.month);
  const { from, to } = monthRange(year, month);

  const [funnel, planFact, proposals] = await Promise.all([
    getFunnelAnalytics(prisma, session, { from, to }),
    getPlanFact(prisma, session, { year, month }),
    // `У-166`: конверсия предложений — тот же месяц, что у остальных блоков.
    getProposalConversion(prisma, session, { year, month }),
  ]);
  if (!funnel.ok || !planFact.ok || !proposals.ok) notFound();

  const monthValue = `${year}-${String(month).padStart(2, '0')}`;

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          title="Аналитика"
          subtitle="Конверсия воронки и коммерческих предложений за период, выполнение плана продаж по менеджерам."
        />
      </div>

      <MonthPicker month={monthValue} />

      <FunnelAnalyticsPanel
        snapshot={funnel.snapshot}
        cohort={funnel.cohort}
        perManager={funnel.perManager}
      />

      <ProposalConversionPanel conversion={proposals.conversion} />

      <div>
        <h2 className="text-lg font-semibold text-[#111111] mb-3">План / факт</h2>
        <PlanFactTable year={year} month={month} rows={planFact.rows} totals={planFact.totals} />
      </div>
    </div>
  );
}
