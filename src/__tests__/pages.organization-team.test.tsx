// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listMembers } = vi.hoisted(() => ({ listMembers: vi.fn() }));
vi.mock('@/lib/services/organization/team', () => ({ listMembers }));

const nav = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (props: { activeOrgName: string; children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'org-app-shell' }, props.activeOrgName, props.children)
}));

import OrganizationTeamPage from '@/app/organization/team/page';

function ctx(viewerRole: 'admin' | 'leader' | 'member') {
  return {
    session: { sub: 'u1', role: 'organization' as const, email: 'org@example.com' },
    activeOrgId: 'org-1',
    activeOrgName: 'ООО Ромашка',
    memberships: [],
    viewerRole
  };
}

describe('OrganizationTeamPage', () => {
  beforeEach(() => {
    getOrgPageContext.mockReset();
    listMembers.mockReset();
    nav.redirect.mockClear();
  });

  it('redirects a plain member to /forbidden (page-level guard, defense-in-depth)', async () => {
    getOrgPageContext.mockResolvedValue(ctx('member'));

    await expect(
      renderServerComponent(
        OrganizationTeamPage({ searchParams: Promise.resolve({}) })
      )
    ).rejects.toThrow('REDIRECT:/forbidden');

    expect(listMembers).not.toHaveBeenCalled();
  });

  it('allows a leader to view the team, counting active admins', async () => {
    getOrgPageContext.mockResolvedValue(ctx('leader'));
    listMembers.mockResolvedValue([
      {
        organizationUserId: 'ou1',
        userId: 'u1',
        email: 'admin@example.com',
        name: 'Админ Админов',
        roleInOrg: 'admin',
        isActive: true,
        invitedAt: new Date('2024-01-01'),
        lastLoginAt: null
      },
      {
        organizationUserId: 'ou2',
        userId: 'u2',
        email: 'inactive-admin@example.com',
        name: 'Неактивный Админов',
        roleInOrg: 'admin',
        isActive: false,
        invitedAt: new Date('2024-01-01'),
        lastLoginAt: null
      }
    ]);

    const { container } = await renderServerComponent(
      OrganizationTeamPage({ searchParams: Promise.resolve({ org: 'org-1' }) })
    );

    expect(container.textContent).toContain('Команда');
    expect(container.textContent).toContain('2 участника');
    expect(container.textContent).toContain('1 администратор');
  });

  it('allows an admin to view the team with zero active admins (no admin-count clause rendered)', async () => {
    getOrgPageContext.mockResolvedValue(ctx('admin'));
    listMembers.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      OrganizationTeamPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('0 участников');
    // The "· N администратор(-а/-ов)" clause only renders when activeAdminCount > 0;
    // with zero members there are no active admins, so the KPI paragraph must not
    // contain the "·" admin-count separator.
    const kpiParagraph = container.querySelector('p.text-sm.text-gray-500');
    expect(kpiParagraph?.textContent).not.toContain('·');
  });
});
