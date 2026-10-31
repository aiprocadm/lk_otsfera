// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import LeaderTeamPage from '@/app/leader/team/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));

const { getLeaderTeamBoard } = vi.hoisted(() => ({ getLeaderTeamBoard: vi.fn() }));
vi.mock('@/lib/services/leader/teamBoard', () => ({ getLeaderTeamBoard }));

const { leaderDashboard } = vi.hoisted(() => ({ leaderDashboard: vi.fn() }));
vi.mock('@/lib/services/leader/dashboard', () => ({ leaderDashboard }));

vi.mock('@/components/leader/leader-managers-table', () => ({
  LeaderManagersTable: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'managers-table' }, JSON.stringify(props.rows)),
}));

// `У-130`: карточка «SLA входящих» УЕХАЛА отсюда в хаб настроек — здесь ей
// было не место (настройка процесса в разделе про людей). Мок компонента
// оставлен, чтобы проверять его отсутствие.
vi.mock('@/components/manager/sla-settings-card', () => ({
  SlaSettingsCard: (props: { initial: unknown }) =>
    React.createElement(
      'div',
      { 'data-testid': 'sla-settings-card' },
      JSON.stringify(props.initial)
    ),
}));

vi.mock('@/components/manager/team-visibility-toggle', () => ({
  TeamVisibilityToggle: (props: { initial: boolean }) =>
    React.createElement('div', { 'data-testid': 'visibility-toggle' }, String(props.initial)),
}));

vi.mock('@/components/leader/leader-team-board', () => ({
  LeaderTeamBoard: (props: { board: unknown }) =>
    React.createElement('div', { 'data-testid': 'team-board' }, JSON.stringify(props.board)),
}));

const SESSION = {
  sub: 'u1',
  role: 'leader' as const,
  companyId: 'c1',
};
const SESSION_NO_COMPANY = {
  sub: 'u2',
  role: 'leader' as const,
  companyId: null,
};

describe('LeaderTeamPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    getCompanyTeamVisibility.mockReset();
    getLeaderTeamBoard.mockReset().mockResolvedValue({
      managers: [{ id: 'm1', name: 'Менеджер', orgs: [] }],
      unassigned: { rows: [], total: 0 },
    });
    leaderDashboard.mockReset().mockResolvedValue({
      kpis: {},
      perManager: [{ managerId: 'm1', name: 'Анна Результат', activeOrders: 4 }],
    });
  });

  it('fetches team visibility and roster when session has a companyId', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    getCompanyTeamVisibility.mockResolvedValue(true);

    const { container } = await renderServerComponent(LeaderTeamPage());

    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    // `У-346`: организации менеджеров, перевод и назначение — доска по макету 2
    expect(getLeaderTeamBoard).toHaveBeenCalledWith({}, SESSION);
    expect(container.querySelector('[data-testid="team-board"]')).not.toBeNull();
    expect(container.textContent).toContain('Команда');
    expect(container.textContent).toContain('true');
    expect(container.textContent).toContain('Менеджер');
    // `У-130`: порогов SLA здесь больше нет — они в «Настройках».
    expect(container.querySelector('[data-testid="sla-settings-card"]')).toBeNull();
    // `У-346`: таблица «Менеджеры команды» переехала сюда с главной
    expect(leaderDashboard).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Менеджеры команды');
    expect(container.querySelector('[data-testid="managers-table"]')?.textContent).toContain(
      'Анна Результат'
    );
  });

  it('short-circuits to teamMode:false and an empty roster when session has no companyId', async () => {
    requireManagerLeader.mockResolvedValue(SESSION_NO_COMPANY);

    const { container } = await renderServerComponent(LeaderTeamPage());

    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    // без компании сервис сам вернёт пустую доску (C8) — страница не решает за него
    expect(container.querySelector('[data-testid="sla-settings-card"]')).toBeNull();
    expect(container.textContent).toContain('false');
  });
});
