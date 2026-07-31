// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminRolesPage from '@/app/admin/roles/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listAccessProfiles, listAssignableUsers } = vi.hoisted(() => ({
  listAccessProfiles: vi.fn(),
  listAssignableUsers: vi.fn()
}));
vi.mock('@/lib/services/access/profiles', () => ({ listAccessProfiles, listAssignableUsers }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/access/role-editor', () => ({
  RoleEditor: (props: { profiles: unknown[]; users: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'role-editor' }, JSON.stringify(props.profiles), JSON.stringify(props.users))
}));


const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminRolesPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    isFeatureEnabled.mockReset();
    listAccessProfiles.mockReset();
    listAssignableUsers.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when role_constructor flag is disabled', async () => {
    isFeatureEnabled.mockReturnValue(false);

    await expect(renderServerComponent(AdminRolesPage())).rejects.toThrow('NOT_FOUND');

    expect(isFeatureEnabled).toHaveBeenCalledWith('role_constructor');
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('renders profiles/users when both service calls succeed', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireAdmin.mockResolvedValue(SESSION);
    listAccessProfiles.mockResolvedValue({ ok: true, rows: [{ id: 'pr1' }] });
    listAssignableUsers.mockResolvedValue({ ok: true, rows: [{ id: 'u1' }] });

    const { container } = await renderServerComponent(AdminRolesPage());

    expect(listAccessProfiles).toHaveBeenCalledWith({}, SESSION);
    expect(listAssignableUsers).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('pr1');
    expect(container.textContent).toContain('u1');
  });

  it('falls back to [] for profiles/users when the service calls return ok:false', async () => {
    isFeatureEnabled.mockReturnValue(true);
    requireAdmin.mockResolvedValue(SESSION);
    listAccessProfiles.mockResolvedValue({ ok: false, error: 'forbidden' });
    listAssignableUsers.mockResolvedValue({ ok: false, error: 'forbidden' });

    const { container } = await renderServerComponent(AdminRolesPage());

    const editor = container.querySelector('[data-testid="role-editor"]');
    expect(editor?.textContent).toContain('[][]');
  });
});
