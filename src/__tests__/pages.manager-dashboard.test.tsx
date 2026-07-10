// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { kpis, attention, recentEvents } = vi.hoisted(() => ({
  kpis: vi.fn(),
  attention: vi.fn(),
  recentEvents: vi.fn()
}));
vi.mock('@/lib/services/manager/dashboard', () => ({ kpis, attention, recentEvents }));

vi.mock('@/components/manager/manager-kpi-grid', () => ({
  ManagerKpiGrid: (props: { data: unknown }) =>
    React.createElement('div', { 'data-testid': 'kpi-grid' }, JSON.stringify(props.data))
}));

vi.mock('@/components/manager/manager-attention-list', () => ({
  ManagerAttentionList: (props: { items: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'attention-list' }, JSON.stringify(props.items))
}));

vi.mock('@/components/manager/manager-events-feed', () => ({
  ManagerEventsFeed: (props: { events: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'events-feed' }, JSON.stringify(props.events))
}));

import ManagerDashboard from '@/app/manager/dashboard/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };

describe('ManagerDashboard', () => {
  beforeEach(() => {
    requireManager.mockReset();
    getCompanyTeamVisibility.mockReset();
    getCompanyTeamVisibility.mockResolvedValue(true);
    kpis.mockReset();
    attention.mockReset();
    recentEvents.mockReset();
  });

  it('fetches kpis/attention/events in parallel, resolving teamMode ONCE for all three', async () => {
    requireManager.mockResolvedValue(SESSION);
    kpis.mockResolvedValue({ activeOrders: 1 });
    attention.mockResolvedValue([{ id: 'a1' }]);
    recentEvents.mockResolvedValue([{ id: 'e1' }]);

    const { container } = await renderServerComponent(ManagerDashboard());

    expect(requireManager).toHaveBeenCalled();
    // R2: один рид флага на запрос, прокинутый во все три сервиса — вместо
    // трёх одинаковых внутри kpis/attention/recentEvents.
    expect(getCompanyTeamVisibility).toHaveBeenCalledTimes(1);
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(kpis).toHaveBeenCalledWith({}, SESSION, true);
    expect(attention).toHaveBeenCalledWith({}, SESSION, true);
    expect(recentEvents).toHaveBeenCalledWith({}, SESSION, undefined, true);
    expect(container.textContent).toContain('Главная');
    expect(container.textContent).toContain('activeOrders');
    expect(container.textContent).toContain('a1');
    expect(container.textContent).toContain('e1');
  });

  it('renders with empty attention/events arrays', async () => {
    requireManager.mockResolvedValue(SESSION);
    kpis.mockResolvedValue({});
    attention.mockResolvedValue([]);
    recentEvents.mockResolvedValue([]);

    const { container } = await renderServerComponent(ManagerDashboard());

    expect(container.textContent).toContain('Главная');
  });
});
