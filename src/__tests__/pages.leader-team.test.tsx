// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));

const { listCompanyManagers } = vi.hoisted(() => ({ listCompanyManagers: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

// Этап 7 (PR-3): карточка «SLA входящих» — сервис и компонент стабятся.
const { getSlaSettings } = vi.hoisted(() => ({ getSlaSettings: vi.fn() }));
vi.mock('@/lib/services/manager/slaSettings', () => ({ getSlaSettings }));
vi.mock('@/components/manager/sla-settings-card', () => ({
  SlaSettingsCard: (props: { initial: unknown }) =>
    React.createElement('div', { 'data-testid': 'sla-settings-card' }, JSON.stringify(props.initial))
}));

vi.mock('@/components/manager/team-visibility-toggle', () => ({
  TeamVisibilityToggle: (props: { initial: boolean }) =>
    React.createElement('div', { 'data-testid': 'visibility-toggle' }, String(props.initial))
}));

vi.mock('@/components/manager/manager-roster-panel', () => ({
  ManagerRosterPanel: (props: { roster: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'roster-panel' }, JSON.stringify(props.roster))
}));

import LeaderTeamPage from '@/app/leader/team/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'leader' as const, companyId: 'c1' };
const SESSION_NO_COMPANY = { sub: 'u2', role: 'manager' as const, managerRole: 'leader' as const, companyId: null };

describe('LeaderTeamPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    getCompanyTeamVisibility.mockReset();
    listCompanyManagers.mockReset();
    getSlaSettings.mockReset().mockResolvedValue({ slaResponseHours: 24, slaWarningHours: 4 });
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
    // Этап 7 (PR-3): карточка SLA с порогами компании.
    expect(getSlaSettings).toHaveBeenCalledWith({}, 'c1');
    expect(container.querySelector('[data-testid="sla-settings-card"]')?.textContent).toContain('24');
  });

  it('short-circuits to teamMode:false and an empty roster when session has no companyId', async () => {
    requireManagerLeader.mockResolvedValue(SESSION_NO_COMPANY);

    const { container } = await renderServerComponent(LeaderTeamPage());

    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(listCompanyManagers).not.toHaveBeenCalled();
    expect(getSlaSettings).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="sla-settings-card"]')).toBeNull();
    expect(container.textContent).toContain('false');
  });
});
