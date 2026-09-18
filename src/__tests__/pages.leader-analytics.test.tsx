// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import LeaderAnalyticsPage from '@/app/leader/analytics/page';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * «Аналитика» руководителя — пять вкладок (`У-243`, этап 7).
 *
 * Главное, что здесь проверяется: **данные считаются только для открытой
 * вкладки**. Считать все пять на каждый показ значило бы платить за четыре
 * отчёта, которых никто не смотрит, — и на ста тысячах заказов это заметно.
 */
const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { getFunnelAnalytics, getPlanFact, getProposalConversion, monthRange } = vi.hoisted(() => ({
  getFunnelAnalytics: vi.fn(),
  getPlanFact: vi.fn(),
  getProposalConversion: vi.fn(),
  monthRange: vi.fn(),
}));
vi.mock('@/lib/services/leader/analytics', () => ({
  getFunnelAnalytics,
  getPlanFact,
  getProposalConversion,
  monthRange,
}));

const { getKpiPlanFact, getReceivables, getCommunications, getSources, getPartnersAnalytics } =
  vi.hoisted(() => ({
    getKpiPlanFact: vi.fn(),
    getReceivables: vi.fn(),
    getCommunications: vi.fn(),
    getSources: vi.fn(),
    getPartnersAnalytics: vi.fn(),
  }));
vi.mock('@/lib/kpi/plan', () => ({ getKpiPlanFact }));
vi.mock('@/lib/services/leader/receivables', () => ({ getReceivables }));
vi.mock('@/lib/services/leader/communications', () => ({ getCommunications }));
vi.mock('@/lib/services/leader/sources', () => ({ getSources }));
vi.mock('@/lib/services/leader/partnersAnalytics', () => ({ getPartnersAnalytics }));

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
vi.mock('@/components/leader/analytics/proposal-conversion-panel', () => ({
  ProposalConversionPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'proposal-panel' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/kpi-plan-fact-table', () => ({
  KpiPlanFactTable: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'kpi-plan-fact' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/receivables-panel', () => ({
  ReceivablesPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'receivables-panel' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/communications-panel', () => ({
  CommunicationsPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'communications-panel' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/sources-panel', () => ({
  SourcesPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'sources-panel' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/partners-analytics-panel', () => ({
  PartnersAnalyticsPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'partners-panel' }, JSON.stringify(props)),
}));

const SESSION = { sub: 'u1', role: 'leader' as const, companyId: 'c1' };

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
const CONVERSION_OK = {
  ok: true as const,
  conversion: {
    sent: 4,
    accepted: 1,
    rejected: 1,
    expired: 0,
    cancelled: 0,
    pending: 2,
    conversionPct: 25,
  },
};
const PLAN_FACT_OK = {
  ok: true as const,
  rows: [],
  totals: { target: '0.00', fact: '0.00', executionPct: null },
};

function sp(params: { month?: string; tab?: string; older?: string } = {}) {
  return Promise.resolve(params);
}

describe('LeaderAnalyticsPage — вкладки (У-243)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    requireManagerLeader.mockResolvedValue(SESSION);
    monthRange.mockReturnValue({ from: new Date('2026-05-01'), to: new Date('2026-06-01') });
    getFunnelAnalytics.mockResolvedValue(FUNNEL_OK);
    getPlanFact.mockResolvedValue(PLAN_FACT_OK);
    getProposalConversion.mockResolvedValue(CONVERSION_OK);
    getKpiPlanFact.mockResolvedValue({ year: 2026, month: 5, metrics: [], rows: [] });
    getReceivables.mockResolvedValue({ rows: [], totalDebt: '0.00', olderThanDays: 0 });
    getCommunications.mockResolvedValue({
      byChannel: [],
      byManager: [],
      calls: { inbound: 0, answered: 0, missed: 0, outbound: 0 },
      slaHours: 24,
    });
    getSources.mockResolvedValue({
      leads: [],
      requests: [],
      totalLeads: 0,
      totalDeals: 0,
      totalOrders: 0,
    });
    getPartnersAnalytics.mockResolvedValue({
      rows: [],
      totalAccrued: '0.00',
      totalPaid: '0.00',
    });
  });
  afterEach(() => vi.useRealTimers());

  it('флаг выключен — «не найдено» до проверки прав', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(
      renderServerComponent(LeaderAnalyticsPage({ searchParams: sp() }))
    ).rejects.toThrow('NOT_FOUND');
    expect(isFeatureEnabled).toHaveBeenCalledWith('leader_analytics');
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('по умолчанию открыт «План и факт»; отчёты других вкладок НЕ считаются', async () => {
    const { getByTestId } = await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp({ month: '2026-05' }) })
    );
    expect(getByTestId('kpi-plan-fact')).toBeTruthy();
    expect(getByTestId('plan-fact-table')).toBeTruthy();
    expect(getKpiPlanFact).toHaveBeenCalledWith({}, { companyId: 'c1', year: 2026, month: 5 });
    // Считать всё сразу — платить за четыре отчёта, которых никто не смотрит.
    expect(getCommunications).not.toHaveBeenCalled();
    expect(getReceivables).not.toHaveBeenCalled();
    expect(getPartnersAnalytics).not.toHaveBeenCalled();
    expect(getFunnelAnalytics).not.toHaveBeenCalled();
  });

  it('мусор в адресе вкладки — открывается «План и факт», а не пустота', async () => {
    const { getByTestId } = await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp({ month: '2026-05', tab: 'выдуманная' }) })
    );
    expect(getByTestId('kpi-plan-fact')).toBeTruthy();
  });

  it('вкладка «Воронка»: прежние блоки плюс источники', async () => {
    const { getByTestId } = await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp({ month: '2026-05', tab: 'funnel' }) })
    );
    expect(getByTestId('funnel-panel')).toBeTruthy();
    expect(getByTestId('proposal-panel').textContent).toContain('"conversionPct":25');
    expect(getByTestId('sources-panel')).toBeTruthy();
    expect(getSources).toHaveBeenCalled();
  });

  it('вкладка «Коммуникации» считает только свой отчёт', async () => {
    const { getByTestId } = await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp({ month: '2026-05', tab: 'communications' }) })
    );
    expect(getByTestId('communications-panel')).toBeTruthy();
    expect(getKpiPlanFact).not.toHaveBeenCalled();
  });

  it('вкладка «Дебиторка» передаёт фильтр по сроку; мусор — ноль', async () => {
    await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp({ tab: 'receivables', older: '60' }) })
    );
    expect(getReceivables.mock.calls[0][1]).toMatchObject({ olderThanDays: 60 });

    vi.clearAllMocks();
    getReceivables.mockResolvedValue({ rows: [], totalDebt: '0.00', olderThanDays: 0 });
    await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp({ tab: 'receivables', older: 'вчера' }) })
    );
    expect(getReceivables.mock.calls[0][1]).toMatchObject({ olderThanDays: 0 });
  });

  it('вкладка «Партнёры» показывает свою панель', async () => {
    const { getByTestId } = await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp({ tab: 'partners' }) })
    );
    expect(getByTestId('partners-panel')).toBeTruthy();
  });

  it('месяц без параметра — текущий; выбор месяца виден на каждой вкладке', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
    const { getByTestId } = await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp({ tab: 'communications' }) })
    );
    expect(getByTestId('month-picker').textContent).toBe('2026-07');
  });

  it('отказ сервиса на своей вкладке — «не найдено», а не экран с нулями', async () => {
    getPlanFact.mockResolvedValue({ ok: false, error: 'invalid_period' });
    await expect(
      renderServerComponent(LeaderAnalyticsPage({ searchParams: sp({ month: '2026-05' }) }))
    ).rejects.toThrow('NOT_FOUND');

    getPlanFact.mockResolvedValue(PLAN_FACT_OK);
    getFunnelAnalytics.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(
      renderServerComponent(
        LeaderAnalyticsPage({ searchParams: sp({ month: '2026-05', tab: 'funnel' }) })
      )
    ).rejects.toThrow('NOT_FOUND');
  });

  it('вкладка «Экспорт»: список отчётов, ни один отчёт аналитики не считается', async () => {
    const { getByTestId } = await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp({ month: '2026-05', tab: 'export' }) })
    );
    expect(getByTestId('reports-export')).toBeTruthy();
    // Список — это ссылки; считать данные шести отчётов ради него не нужно.
    expect(getKpiPlanFact).not.toHaveBeenCalled();
    expect(getReceivables).not.toHaveBeenCalled();
    expect(getByTestId('report-download-receivables').getAttribute('href')).toContain(
      '/api/reports/receivables/export?month=2026-05'
    );
  });

  it('на обычной вкладке есть своя кнопка «Скачать XLSX», на «Экспорте» её нет', async () => {
    const onTab = await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp({ month: '2026-05', tab: 'receivables' }) })
    );
    expect(onTab.getByTestId('tab-download-receivables').getAttribute('href')).toContain(
      '/api/reports/receivables/export?month=2026-05'
    );

    const onExport = await renderServerComponent(
      LeaderAnalyticsPage({ searchParams: sp({ month: '2026-05', tab: 'export' }) })
    );
    // Ищем в СВОЁМ куске разметки: обе отрисовки живут в одном документе.
    expect(
      onExport.container.querySelector('[data-testid="tab-download-receivables"]'),
      'на «Экспорте» кнопка вкладки была бы дублем списка'
    ).toBeNull();
  });

  it('у сотрудника без компании отчётов нет вовсе', async () => {
    requireManagerLeader.mockResolvedValue({ sub: 'u2', role: 'leader' });
    await expect(
      renderServerComponent(LeaderAnalyticsPage({ searchParams: sp() }))
    ).rejects.toThrow('NOT_FOUND');
  });
});
