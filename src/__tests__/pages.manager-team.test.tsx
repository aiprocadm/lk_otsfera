// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerTeamPage from '@/app/manager/team/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { getCompanyTeamVisibility } = vi.hoisted(() => ({ getCompanyTeamVisibility: vi.fn() }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));

const { listCompanyManagers } = vi.hoisted(() => ({ listCompanyManagers: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

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
  role: 'manager' as const,
  managerRole: 'leader' as const,
  companyId: 'c1',
};
const SESSION_NO_COMPANY = {
  sub: 'u2',
  role: 'manager' as const,
  managerRole: 'leader' as const,
  companyId: null,
};

describe('ManagerTeamPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    isFeatureEnabled.mockReset();
    getCompanyTeamVisibility.mockReset();
    listCompanyManagers.mockReset();
    nav.redirect.mockClear();
  });

  it('redirects to /leader/team when leader_cabinet is enabled', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    isFeatureEnabled.mockReturnValue(true);

    await expect(renderServerComponent(ManagerTeamPage())).rejects.toThrow('REDIRECT:/leader/team');

    expect(isFeatureEnabled).toHaveBeenCalledWith('leader_cabinet');
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
  });

  it('fetches team visibility and roster when leader_cabinet is disabled and session has a companyId', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    isFeatureEnabled.mockReturnValue(false);
    getCompanyTeamVisibility.mockResolvedValue(true);
    listCompanyManagers.mockResolvedValue([{ id: 'm1', name: 'Менеджер' }]);

    const { container } = await renderServerComponent(ManagerTeamPage());

    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(listCompanyManagers).toHaveBeenCalledWith({}, 'c1');
    expect(container.textContent).toContain('Команда');
    expect(container.textContent).toContain('true');
    expect(container.textContent).toContain('Менеджер');
  });

  it('short-circuits to teamMode:false and an empty roster when session has no companyId', async () => {
    requireManagerLeader.mockResolvedValue(SESSION_NO_COMPANY);
    isFeatureEnabled.mockReturnValue(false);

    const { container } = await renderServerComponent(ManagerTeamPage());

    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(listCompanyManagers).not.toHaveBeenCalled();
    expect(container.textContent).toContain('false');
  });
});
