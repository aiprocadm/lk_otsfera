// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * «Финансы» администратора: прежний свод по всем организациям плюс те же пять
 * вкладок аналитики, что у руководителя, с выбором компании (`У-243`, `Р-Э7-8`).
 */
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

const { companyFindMany } = vi.hoisted(() => ({ companyFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { company: { findMany: companyFindMany } } }));

const { getManagerFinanceOverview } = vi.hoisted(() => ({ getManagerFinanceOverview: vi.fn() }));
vi.mock('@/lib/services/manager/finance', () => ({ getManagerFinanceOverview }));

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

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));

vi.mock('@/components/manager/manager-finance-view', () => ({
  ManagerFinanceView: (props: { data: unknown; ordersBasePath?: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'finance-view' },
      props.ordersBasePath,
      JSON.stringify(props.data)
    ),
}));
vi.mock('@/components/leader/analytics/kpi-plan-fact-table', () => ({
  KpiPlanFactTable: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'kpi-plan-fact' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/plan-fact-table', () => ({
  PlanFactTable: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'plan-fact-table' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/funnel-analytics-panel', () => ({
  FunnelAnalyticsPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'funnel-panel' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/proposal-conversion-panel', () => ({
  ProposalConversionPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'proposal-panel' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/sources-panel', () => ({
  SourcesPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'sources-panel' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/receivables-panel', () => ({
  ReceivablesPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'receivables-panel' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/communications-panel', () => ({
  CommunicationsPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'communications-panel' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/partners-analytics-panel', () => ({
  PartnersAnalyticsPanel: (props: unknown) =>
    React.createElement('div', { 'data-testid': 'partners-panel' }, JSON.stringify(props)),
}));
vi.mock('@/components/leader/analytics/month-picker', () => ({
  MonthPicker: (props: { month: string }) =>
    React.createElement('div', { 'data-testid': 'month-picker' }, props.month),
}));

import AdminFinancePage from '@/app/admin/finance/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };
const OVERVIEW = { summary: { totalDebt: '0.00' }, sections: [], canSeeCommission: true };
const PLAN_FACT_OK = {
  ok: true as const,
  rows: [],
  totals: { target: '0.00', fact: '0.00', executionPct: null },
};

function sp(params: Record<string, string> = {}) {
  return Promise.resolve(params);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(SESSION);
  getManagerFinanceOverview.mockResolvedValue(OVERVIEW);
  isFeatureEnabled.mockReturnValue(true);
  companyFindMany.mockResolvedValue([
    { id: 'c1', name: 'Первая' },
    { id: 'c2', name: 'Вторая' },
  ]);
  monthRange.mockReturnValue({ from: new Date('2026-05-01'), to: new Date('2026-06-01') });
  getKpiPlanFact.mockResolvedValue({ year: 2026, month: 5, metrics: [], rows: [] });
  getPlanFact.mockResolvedValue(PLAN_FACT_OK);
});

describe('AdminFinancePage', () => {
  it('прежний свод по всем организациям остался на месте', async () => {
    const { container, getByTestId } = await renderServerComponent(
      AdminFinancePage({ searchParams: sp() })
    );
    expect(requireAdmin).toHaveBeenCalled();
    expect(getManagerFinanceOverview).toHaveBeenCalledWith(expect.anything(), SESSION, {
      teamMode: false,
    });
    expect(container.textContent).toContain('Финансы');
    expect(getByTestId('finance-view').textContent).toContain('/admin');
  });

  it('вкладки аналитики те же, что у руководителя; по умолчанию — «План и факт»', async () => {
    const { getByTestId } = await renderServerComponent(
      AdminFinancePage({ searchParams: sp({ month: '2026-05' }) })
    );
    expect(getByTestId('admin-analytics')).toBeTruthy();
    expect(getByTestId('analytics-tabs').textContent).toContain('План и факт');
    expect(getByTestId('analytics-tabs').textContent).toContain('Дебиторка');
    expect(getByTestId('kpi-plan-fact')).toBeTruthy();
  });

  it('выгрузка несёт выбранную компанию: и кнопка вкладки, и список «Экспорта»', async () => {
    const onTab = await renderServerComponent(
      AdminFinancePage({
        searchParams: sp({ month: '2026-05', company: 'c2', tab: 'receivables' }),
      })
    );
    // Без компании в адресе администратор скачал бы отчёт «ни по какой» компании.
    expect(onTab.getByTestId('tab-download-receivables').getAttribute('href')).toContain(
      'company=c2'
    );

    const onExport = await renderServerComponent(
      AdminFinancePage({ searchParams: sp({ month: '2026-05', company: 'c2', tab: 'export' }) })
    );
    const link = onExport.container.querySelector(
      '[data-testid="report-download-manager_load"]'
    ) as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toContain('company=c2');
  });

  it('компания берётся из адреса; чужой идентификатор — первая по алфавиту', async () => {
    await renderServerComponent(AdminFinancePage({ searchParams: sp({ company: 'c2' }) }));
    expect(getKpiPlanFact.mock.calls[0][1]).toMatchObject({ companyId: 'c2' });

    vi.clearAllMocks();
    companyFindMany.mockResolvedValue([{ id: 'c1', name: 'Первая' }]);
    getKpiPlanFact.mockResolvedValue({ year: 2026, month: 5, metrics: [], rows: [] });
    getPlanFact.mockResolvedValue(PLAN_FACT_OK);
    monthRange.mockReturnValue({ from: new Date('2026-05-01'), to: new Date('2026-06-01') });
    await renderServerComponent(AdminFinancePage({ searchParams: sp({ company: 'чужая' }) }));
    expect(getKpiPlanFact.mock.calls[0][1]).toMatchObject({ companyId: 'c1' });
  });

  it('аналитика считается за ВЫБРАННУЮ компанию, а не за сессию администратора', async () => {
    getFunnelAnalytics.mockResolvedValue({
      ok: true,
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
    });
    getProposalConversion.mockResolvedValue({
      ok: true,
      conversion: {
        sent: 0,
        accepted: 0,
        rejected: 0,
        expired: 0,
        cancelled: 0,
        pending: 0,
        conversionPct: null,
      },
    });
    getSources.mockResolvedValue({
      leads: [],
      requests: [],
      totalLeads: 0,
      totalDeals: 0,
      totalOrders: 0,
    });

    await renderServerComponent(
      AdminFinancePage({ searchParams: sp({ company: 'c2', tab: 'funnel' }) })
    );
    // Сессия администратора компании не несёт — её подставляет страница, иначе
    // воронка посчиталась бы «ни по какой компании».
    expect(getFunnelAnalytics.mock.calls[0][1]).toMatchObject({ companyId: 'c2' });
    expect(getSources.mock.calls[0][1]).toMatchObject({ companyId: 'c2' });
  });

  it('флаг выключен — вкладок нет, свод остаётся', async () => {
    isFeatureEnabled.mockReturnValue(false);
    const { queryByTestId, getByTestId } = await renderServerComponent(
      AdminFinancePage({ searchParams: sp() })
    );
    expect(queryByTestId('admin-analytics')).toBeNull();
    expect(getByTestId('finance-view')).toBeTruthy();
    expect(companyFindMany).not.toHaveBeenCalled();
  });

  it('компаний нет вовсе — вкладки не рисуются, страница цела', async () => {
    companyFindMany.mockResolvedValue([]);
    const { queryByTestId, getByTestId } = await renderServerComponent(
      AdminFinancePage({ searchParams: sp() })
    );
    expect(queryByTestId('admin-analytics')).toBeNull();
    expect(getByTestId('finance-view')).toBeTruthy();
  });
});

/**
 * Остальные вкладки аналитики администратора (`У-243`).
 *
 * Правило зеркала (§0.2): вкладок пять и у руководителя, и у администратора,
 * и каждая обязана показывать СВОЮ панель за ВЫБРАННУЮ компанию. Вкладка,
 * которая молча открывает соседнюю панель, — дефект приёмки: человек примет
 * чужие цифры за свои.
 */
describe('AdminFinancePage — остальные вкладки', () => {
  beforeEach(() => {
    getCommunications.mockResolvedValue({ rows: [] });
    getPartnersAnalytics.mockResolvedValue({ rows: [] });
    getReceivables.mockResolvedValue({ rows: [] });
    getFunnelAnalytics.mockResolvedValue({ ok: true, snapshot: {}, cohort: {}, perManager: [] });
    getProposalConversion.mockResolvedValue({ ok: true, conversion: {} });
    getSources.mockResolvedValue({ rows: [] });
  });

  it('«Коммуникации» показывают свою панель за выбранную компанию', async () => {
    const { container } = await renderServerComponent(
      AdminFinancePage({ searchParams: sp({ tab: 'communications', company: 'c2' }) })
    );

    expect(container.querySelector('[data-testid="communications-panel"]')).toBeTruthy();
    expect(getCommunications.mock.calls[0]?.[1]).toMatchObject({ companyId: 'c2' });
  });

  it('«Партнёры» показывают свою панель за выбранную компанию', async () => {
    const { container } = await renderServerComponent(
      AdminFinancePage({ searchParams: sp({ tab: 'partners', company: 'c2' }) })
    );

    expect(container.querySelector('[data-testid="partners-panel"]')).toBeTruthy();
    expect(getPartnersAnalytics.mock.calls[0]?.[1]).toMatchObject({ companyId: 'c2' });
  });

  it('«Воронка» собирает три панели разом', async () => {
    const { container } = await renderServerComponent(
      AdminFinancePage({ searchParams: sp({ tab: 'funnel' }) })
    );

    expect(container.querySelector('[data-testid="funnel-panel"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="proposal-panel"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="sources-panel"]')).toBeTruthy();
  });

  it.each([
    ['воронка', { getFunnelAnalytics: true }],
    ['конверсия предложений', { getProposalConversion: true }],
  ])('отказ сервиса «%s» — «не найдено», а не полупустая вкладка', async (_name, which) => {
    if ('getFunnelAnalytics' in which) {
      getFunnelAnalytics.mockResolvedValue({ ok: false, error: 'forbidden' });
    } else {
      getProposalConversion.mockResolvedValue({ ok: false, error: 'forbidden' });
    }

    await expect(
      renderServerComponent(AdminFinancePage({ searchParams: sp({ tab: 'funnel' }) }))
    ).rejects.toThrow('NOT_FOUND');
  });

  it('отказ плана-факта — «не найдено»: половина таблицы хуже честного отказа', async () => {
    getPlanFact.mockResolvedValue({ ok: false, error: 'forbidden' });

    await expect(
      renderServerComponent(AdminFinancePage({ searchParams: sp({ tab: 'plan' }) }))
    ).rejects.toThrow('NOT_FOUND');
  });
});
