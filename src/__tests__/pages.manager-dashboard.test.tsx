// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerDashboard from '@/app/manager/dashboard/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { kpis, attention, recentEvents } = vi.hoisted(() => ({
  kpis: vi.fn(),
  attention: vi.fn(),
  recentEvents: vi.fn(),
}));
vi.mock('@/lib/services/manager/dashboard', () => ({ kpis, attention, recentEvents }));

// Этап 11 PR-2 (ФТ-15.3): «Мой день» — первый блок «Главной».
const { getMyDay } = vi.hoisted(() => ({ getMyDay: vi.fn() }));
vi.mock('@/lib/services/manager/myDay', () => ({ getMyDay }));
vi.mock('@/components/manager/my-day-cards', () => ({
  MyDayCards: (props: { data: unknown }) =>
    React.createElement('div', { 'data-testid': 'my-day' }, JSON.stringify(props.data)),
}));

vi.mock('@/components/manager/manager-kpi-grid', () => ({
  ManagerKpiGrid: (props: { data: unknown }) =>
    React.createElement('div', { 'data-testid': 'kpi-grid' }, JSON.stringify(props.data)),
}));

// `У-245` (этап 7): блок «Мои KPI за месяц» под флагом этапа.
const { getMyKpi, isFeatureEnabled } = vi.hoisted(() => ({
  getMyKpi: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));
vi.mock('@/lib/services/manager/myKpi', () => ({ getMyKpi }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/components/manager/my-kpi-grid', () => ({
  MyKpiGrid: (props: { rows: unknown[]; month: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'my-kpi' },
      `${props.month}:${JSON.stringify(props.rows)}`
    ),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  companyId: 'c1',
};

describe('ManagerDashboard', () => {
  beforeEach(() => {
    requireManager.mockReset();
    getCompanyTeamVisibility.mockReset();
    getCompanyTeamVisibility.mockResolvedValue(true);
    kpis.mockReset();
    attention.mockReset();
    recentEvents.mockReset();
    getMyDay.mockReset();
    getMyDay.mockResolvedValue({ tasksToday: 0 });
    getMyKpi.mockReset();
    getMyKpi.mockResolvedValue([{ metric: 'revenue_paid', fact: '10' }]);
    isFeatureEnabled.mockReset();
    isFeatureEnabled.mockReturnValue(false);
  });

  it('kpis и «Мой день» получают один и тот же единожды прочитанный teamMode', async () => {
    requireManager.mockResolvedValue(SESSION);
    kpis.mockResolvedValue({ activeOrders: 1 });

    const { container } = await renderServerComponent(ManagerDashboard());

    expect(requireManager).toHaveBeenCalled();
    // R2: один рид флага на запрос, прокинутый во все сервисы, — вместо
    // одинаковых внутри каждого.
    expect(getCompanyTeamVisibility).toHaveBeenCalledTimes(1);
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(kpis).toHaveBeenCalledWith({}, SESSION, true);
    // «Мой день» получает тот же единожды прочитанный teamMode.
    expect(getMyDay).toHaveBeenCalledWith({}, SESSION, true);
    expect(container.textContent).toContain('tasksToday');
    expect(container.textContent).toContain('Главная');
    expect(container.textContent).toContain('activeOrders');
  });

  it('этап 4 ТЗ 13.10.2026 (`У-297`, `Р-4-6`): списка «Требует внимания» и ленты событий на главной нет', async () => {
    requireManager.mockResolvedValue(SESSION);
    kpis.mockResolvedValue({});
    const { container } = await renderServerComponent(ManagerDashboard());
    // Дублировали «Мой день» — их сервисы даже не зовутся.
    expect(attention).not.toHaveBeenCalled();
    expect(recentEvents).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Ничего срочного');
    expect(container.textContent).not.toContain('Нет событий за последний период');
  });

  it('флаг выключен — блока «Мои KPI» нет и считать его не начинают', async () => {
    requireManager.mockResolvedValue(SESSION);
    kpis.mockResolvedValue({});

    const { queryByTestId } = await renderServerComponent(ManagerDashboard());

    expect(queryByTestId('my-kpi')).toBeNull();
    // Считать показатели впустую — платить за экран, которого не видно.
    expect(getMyKpi).not.toHaveBeenCalled();
  });

  it('флаг включён — считаются МОИ показатели за текущий месяц', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    kpis.mockResolvedValue({});

    const { getByTestId } = await renderServerComponent(ManagerDashboard());

    expect(isFeatureEnabled).toHaveBeenCalledWith('leader_analytics');
    const args = getMyKpi.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(args[1], 'показатели считаются не за себя или не за свою компанию').toMatchObject({
      companyId: 'c1',
      managerId: 'u1',
    });
    expect(getByTestId('my-kpi').textContent).toContain('revenue_paid');
  });

  it('у сотрудника без компании блок не считается, а страница цела', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue({ sub: 'u2', role: 'manager' as const });
    getCompanyTeamVisibility.mockResolvedValue(false);
    kpis.mockResolvedValue({});

    const { queryByTestId, container } = await renderServerComponent(ManagerDashboard());

    expect(getMyKpi).not.toHaveBeenCalled();
    expect(queryByTestId('my-kpi')).toBeNull();
    expect(container.textContent).toContain('Главная');
  });

  it('renders with empty kpis', async () => {
    requireManager.mockResolvedValue(SESSION);
    kpis.mockResolvedValue({});

    const { container } = await renderServerComponent(ManagerDashboard());

    expect(container.textContent).toContain('Главная');
  });
});
