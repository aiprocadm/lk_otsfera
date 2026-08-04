// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import LeaderRolesPage from '@/app/leader/settings/access/roles/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listAccessProfiles, listAssignableUsers } = vi.hoisted(() => ({
  listAccessProfiles: vi.fn(),
  listAssignableUsers: vi.fn(),
}));
vi.mock('@/lib/services/access/profiles', () => ({ listAccessProfiles, listAssignableUsers }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/access/role-editor', () => ({
  RoleEditor: (props: { profiles: unknown[]; users: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'role-editor' },
      JSON.stringify(props.profiles),
      JSON.stringify(props.users)
    ),
}));

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  managerRole: 'leader' as const,
  companyId: 'c1',
};

describe('LeaderRolesPage', () => {
  beforeEach(() => {
    requireSettingsSection.mockReset();
    isFeatureEnabled.mockReset();
    listAccessProfiles.mockReset();
    listAssignableUsers.mockReset();
    nav.notFound.mockClear();
  });

  // Гейт флага role_constructor переехал в requireSettingsSection (хаб настроек).
  it('спрашивает гард именно про раздел «Роли» в кабинете руководителя', async () => {
    requireSettingsSection.mockRejectedValue(new Error('NOT_FOUND'));

    await expect(renderServerComponent(LeaderRolesPage())).rejects.toThrow('NOT_FOUND');

    expect(requireSettingsSection).toHaveBeenCalledWith('access.roles', 'leader');
    expect(listAccessProfiles).not.toHaveBeenCalled();
  });

  it('renders profiles and users when both service calls succeed', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireSettingsSection.mockResolvedValue(SESSION);
    listAccessProfiles.mockResolvedValue({ ok: true, rows: [{ id: 'p1', name: 'Профиль' }] });
    listAssignableUsers.mockResolvedValue({ ok: true, rows: [{ id: 'u2', name: 'Юзер' }] });

    const { container } = await renderServerComponent(LeaderRolesPage());

    expect(listAccessProfiles).toHaveBeenCalledWith({}, SESSION);
    expect(listAssignableUsers).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Профиль');
    expect(container.textContent).toContain('Юзер');
  });

  it('falls back to empty arrays when either service call returns ok:false', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireSettingsSection.mockResolvedValue(SESSION);
    listAccessProfiles.mockResolvedValue({ ok: false, error: 'forbidden' });
    listAssignableUsers.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(LeaderRolesPage());

    expect(container.textContent).toContain('[]');
  });
});
