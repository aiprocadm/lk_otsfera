// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import LeaderAnalyticsPage from '@/app/leader/analytics/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { getFunnelAnalytics, getPlanFact, monthRange } = vi.hoisted(() => ({
  getFunnelAnalytics: vi.fn(),
  getPlanFact: vi.fn(),
  monthRange: vi.fn(),
}));
vi.mock('@/lib/services/leader/analytics', () => ({ getFunnelAnalytics, getPlanFact, monthRange }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/leader/analytics/month-picker', () => ({
  MonthPicker: (props: { month: string }) =>
    React.createElement('div', { 'data-testid': 'month-picker' }, props.month),
}));
vi.mock('@/components/leader/analytics/funnel-analytics-panel', () => ({
  FunnelAnalyticsPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'funnel-panel' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/plan-fact-table', () => ({
  PlanFactTable: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'plan-fact-table' }, JSON.stringify(props)),
}));

const SESSION = {
  sub: 'u1',
  role: 'leader' as const,
  companyId: 'c1',
};

const FUNNEL_OK = {
  ok: true as const,
  snapshot: [],
  cohort: {
    total: 0,
    promoted: 0,
    rejected: 0,
    inWork: 0,
    conversionPct: 0,
    rejectedPct: 0,
    avgDaysToPromote: null,
    estimatedTotal: '0.00',
    promotedEstimated: '0.00',
  },
  perManager: [],
};
const PLAN_FACT_OK = {
  ok: true as const,
  rows: [],
  totals: { target: '0.00', fact: '0.00', executionPct: null },
};

function sp(month?: string): Promise<{ month?: string }> {
  // Месяц не задан → ключа в searchParams нет вовсе (как в реальном запросе без
  // ?month=…); exactOptionalPropertyTypes не даёт написать `{ month: undefined }`.
  return Promise.resolve(month === undefined ? {} : { month });
}

describe('LeaderAnalyticsPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    isFeatureEnabled.mockReset();
    getFunnelAnalytics.mockReset();
    getPlanFact.mockReset();
    monthRange.mockReset();
    nav.notFound.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls notFound() when the leader_analytics flag is disabled (before auth check)', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(
      renderServerComponent(LeaderAnalyticsPage({ searchParams: sp() }))
    ).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('leader_analytics');
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('falls back to the current month when the month param is missing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    const from = new Date('2026-07-01');
    const to = new Date('2026-08-01');
    monthRange.mockReturnValue({ from, to });
    getFunnelAnalytics.mockResolvedValue(FUNNEL_OK);
    getPlanFact.mockResolvedValue(PLAN_FACT_OK);

    await renderServerComponent(LeaderAnalyticsPage({ searchParams: sp(undefined) }));

    expect(monthRange).toHaveBeenCalledWith(2026, 7);
    expect(getFunnelAnalytics).toHaveBeenCalledWith({}, SESSION, { from, to });
    expect(getPlanFact).toHaveBeenCalledWith({}, SESSION, { year: 2026, month: 7 });
  });

  it('falls back to the current month when the month param is malformed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T00:00:00Z'));
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    monthRange.mockReturnValue({ from: new Date('2026-03-01'), to: new Date('2026-04-01') });
    getFunnelAnalytics.mockResolvedValue(FUNNEL_OK);
    getPlanFact.mockResolvedValue(PLAN_FACT_OK);

    await renderServerComponent(LeaderAnalyticsPage({ searchParams: sp('2026-13') }));

    expect(monthRange).toHaveBeenCalledWith(2026, 3);
  });

  it('parses a valid month param and passes {from,to}/{year,month} through to both services', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    const from = new Date('2026-05-01');
    const to = new Date('2026-06-01');
    monthRange.mockReturnValue({ from, to });
    getFunnelAnalytics.mockResolvedValue(FUNNEL_OK);
    getPlanFact.mockResolvedValue(PLAN_FACT_OK);

    const { getByTestId } = await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp('2026-05') })
    );

    expect(monthRange).toHaveBeenCalledWith(2026, 5);
    expect(getFunnelAnalytics).toHaveBeenCalledWith({}, SESSION, { from, to });
    expect(getPlanFact).toHaveBeenCalledWith({}, SESSION, { year: 2026, month: 5 });
    expect(getByTestId('month-picker').textContent).toBe('2026-05');
  });

  it('calls notFound() when getFunnelAnalytics is not ok', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    monthRange.mockReturnValue({ from: new Date('2026-05-01'), to: new Date('2026-06-01') });
    getFunnelAnalytics.mockResolvedValue({ ok: false, error: 'forbidden' });
    getPlanFact.mockResolvedValue(PLAN_FACT_OK);

    await expect(
      renderServerComponent(LeaderAnalyticsPage({ searchParams: sp('2026-05') }))
    ).rejects.toThrow('NOT_FOUND');
  });

  it('calls notFound() when getPlanFact is not ok', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    monthRange.mockReturnValue({ from: new Date('2026-05-01'), to: new Date('2026-06-01') });
    getFunnelAnalytics.mockResolvedValue(FUNNEL_OK);
    getPlanFact.mockResolvedValue({ ok: false, error: 'invalid_period' });

    await expect(
      renderServerComponent(LeaderAnalyticsPage({ searchParams: sp('2026-05') }))
    ).rejects.toThrow('NOT_FOUND');
  });

  it('renders the page shell with both panels when everything succeeds', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    monthRange.mockReturnValue({ from: new Date('2026-05-01'), to: new Date('2026-06-01') });
    getFunnelAnalytics.mockResolvedValue(FUNNEL_OK);
    getPlanFact.mockResolvedValue(PLAN_FACT_OK);

    const { container, getByTestId } = await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp('2026-05') })
    );

    expect(container.textContent).toContain('Аналитика');
    expect(container.textContent).toContain('План / факт');
    expect(getByTestId('funnel-panel')).toBeTruthy();
    expect(getByTestId('plan-fact-table')).toBeTruthy();
  });
});
