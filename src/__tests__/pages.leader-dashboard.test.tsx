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
  });

  it('renders KPI cards, per-manager table, and events feed with commission present', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    leaderDashboard.mockResolvedValue({
      kpis: { managers: 3, activeOrders: 5, debt: '1000.00', commission: '250.00' },
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
    expect(container.textContent).toContain('Менеджеров');
    expect(container.textContent).toContain('250');
  });

  it('renders commission as em-dash when null', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    leaderDashboard.mockResolvedValue({
      kpis: { managers: 0, activeOrders: 0, debt: '0.00', commission: null },
      perManager: [],
    });
    recentEvents.mockResolvedValue([]);

    const { container } = await renderServerComponent(LeaderDashboardPage());

    expect(container.textContent).toContain('—');
  });
});
