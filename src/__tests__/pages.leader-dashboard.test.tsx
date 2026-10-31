// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import LeaderDashboardPage from '@/app/leader/dashboard/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { leaderDashboard } = vi.hoisted(() => ({ leaderDashboard: vi.fn() }));
vi.mock('@/lib/services/leader/dashboard', () => ({ leaderDashboard }));

const { recentEvents } = vi.hoisted(() => ({ recentEvents: vi.fn() }));
vi.mock('@/lib/services/manager/dashboard', () => ({ recentEvents }));

// Прогон №37: раздел задач (`internal_tasks`) включён по умолчанию, поэтому
// главная руководителя на пустом env сразу просит просроченные задачи.
// Обе ветки флага проверены в pages.messages-dashboard-payments.test.tsx.
const { listOverdueTasks } = vi.hoisted(() => ({ listOverdueTasks: vi.fn() }));
vi.mock('@/lib/services/tasks/overdue', () => ({ listOverdueTasks }));

vi.mock('@/components/leader/leader-managers-table', () => ({
  LeaderManagersTable: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'managers-table' }, JSON.stringify(props.rows)),
}));

vi.mock('@/components/manager/manager-events-feed', () => ({
  ManagerEventsFeed: (props: { events: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'events-feed' }, JSON.stringify(props.events)),
}));

const SESSION = {
  sub: 'u1',
  role: 'leader' as const,
  companyId: 'c1',
};

describe('LeaderDashboardPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    leaderDashboard.mockReset();
    recentEvents.mockReset();
    listOverdueTasks.mockReset().mockResolvedValue({ rows: [], total: 0 });
  });

  it('renders KPI cards and events feed with commission present', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    leaderDashboard.mockResolvedValue({
      kpis: {
        managers: 3,
        activeOrders: 5,
        debt: '1000.00',
        commission: '250.00',
        paidThisMonth: '734500.00',
        commissionPaidThisMonth: '1200.00',
      },
      perManager: [
        {
          managerId: 'm1',
          name: 'M',
          email: 'm@x.com',
          activeOrders: 2,
          totalAmount: '100.00',
          paidAmount: '50.00',
          overdue: 0,
        },
      ],
    });
    recentEvents.mockResolvedValue([]);

    const { container } = await renderServerComponent(LeaderDashboardPage());

    expect(requireManagerLeader).toHaveBeenCalled();
    expect(leaderDashboard).toHaveBeenCalledWith({}, SESSION);
    // company-wide always: teamModeOverride=true (4th arg)
    expect(recentEvents).toHaveBeenCalledWith({}, SESSION, undefined, true);
    expect(container.textContent).toContain('Главная');
    expect(container.textContent).toContain('250');
    // `У-345`: плитки без дублей и с подписями, что считают
    const text = container.textContent ?? '';
    expect(text).not.toContain('Менеджеров');
    expect(text).toContain('Оплачено по команде');
    expect(text).toMatch(/734\s500/);
    expect(text).toContain('Отдельно по организациям ›');
    expect(text).toContain('Комиссия посредников');
    expect(text).toMatch(/к выплате · выплачено в этом месяце: 1\s200/);
    // таблица «Менеджеры команды» переехала в «Команду» (`У-346`)
    expect(container.querySelector('[data-testid="managers-table"]')).toBeNull();
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/leader/analytics?tab=plan');
  });

  it('`У-345`: без аналитики «Оплачено по команде» ведёт в «Команду»', async () => {
    vi.stubEnv('FEATURE_LEADER_ANALYTICS', '0');
    requireManagerLeader.mockResolvedValue(SESSION);
    leaderDashboard.mockResolvedValue({
      kpis: {
        managers: 1,
        activeOrders: 0,
        debt: '0.00',
        commission: null,
        paidThisMonth: '0.00',
        commissionPaidThisMonth: '0.00',
      },
      perManager: [],
    });
    recentEvents.mockResolvedValue([]);
    const { container } = await renderServerComponent(LeaderDashboardPage());
    const paid = [...container.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Оплачено по команде')
    );
    expect(paid?.getAttribute('href')).toBe('/leader/team');
    vi.unstubAllEnvs();
  });

  it('renders commission as em-dash when null', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    leaderDashboard.mockResolvedValue({
      kpis: {
        managers: 0,
        activeOrders: 0,
        debt: '0.00',
        commission: null,
        paidThisMonth: '0.00',
        commissionPaidThisMonth: '0.00',
      },
      perManager: [],
    });
    recentEvents.mockResolvedValue([]);

    const { container } = await renderServerComponent(LeaderDashboardPage());

    expect(container.textContent).toContain('—');
    expect(container.textContent).toContain('у организаций нет посредников с комиссией');
  });
});
