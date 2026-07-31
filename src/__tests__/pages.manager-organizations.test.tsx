// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listOrganizations } = vi.hoisted(() => ({ listOrganizations: vi.fn() }));
vi.mock('@/lib/services/manager/organizations', () => ({ listOrganizations }));

vi.mock('@/components/manager/manager-orgs-list', () => ({
  ManagerOrgsList: (props: { orgs: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'orgs-list' }, JSON.stringify(props.orgs)),
}));

import ManagerOrganizationsPage from '@/app/manager/organizations/page';

const SESSION = {
  sub: 'u1',
  role: 'manager' as const,
  managerRole: 'member' as const,
  companyId: 'c1',
};

describe('ManagerOrganizationsPage', () => {
  beforeEach(() => {
    requireManager.mockReset();
    listOrganizations.mockReset();
  });

  it('lists organizations scoped to the manager (no teamModeOverride arg) and renders them', async () => {
    requireManager.mockResolvedValue(SESSION);
    listOrganizations.mockResolvedValue([{ id: 'org1', name: 'Org' }]);

    const { container } = await renderServerComponent(ManagerOrganizationsPage());

    expect(requireManager).toHaveBeenCalled();
    expect(listOrganizations).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Организации');
    expect(container.textContent).toContain('Org');
  });

  it('renders with an empty organizations list', async () => {
    requireManager.mockResolvedValue(SESSION);
    listOrganizations.mockResolvedValue([]);

    const { container } = await renderServerComponent(ManagerOrganizationsPage());

    expect(container.textContent).toContain('Организации');
  });
});
