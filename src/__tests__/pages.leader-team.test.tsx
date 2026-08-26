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

const { listCompanyManagers } = vi.hoisted(() => ({ listCompanyManagers: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

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

vi.mock('@/components/manager/manager-roster-panel', () => ({
  ManagerRosterPanel: (props: { roster: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'roster-panel' }, JSON.stringify(props.roster)),
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
    listCompanyManagers.mockReset();
  });

  it('fetches team visibility and roster when session has a companyId', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    getCompanyTeamVisibility.mockResolvedValue(true);
    listCompanyManagers.mockResolvedValue([{ id: 'm1', name: 'Менеджер' }]);

    const { container } = await renderServerComponent(LeaderTeamPage());

    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(listCompanyManagers).toHaveBeenCalledWith({}, 'c1');
    expect(container.textContent).toContain('Команда');
    expect(container.textContent).toContain('true');
    expect(container.textContent).toContain('Менеджер');
    // `У-130`: порогов SLA здесь больше нет — они в «Настройках».
    expect(container.querySelector('[data-testid="sla-settings-card"]')).toBeNull();
  });

  it('short-circuits to teamMode:false and an empty roster when session has no companyId', async () => {
    requireManagerLeader.mockResolvedValue(SESSION_NO_COMPANY);

    const { container } = await renderServerComponent(LeaderTeamPage());

    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(listCompanyManagers).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="sla-settings-card"]')).toBeNull();
    expect(container.textContent).toContain('false');
  });
});
