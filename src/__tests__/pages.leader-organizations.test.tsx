// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listOrganizations } = vi.hoisted(() => ({ listOrganizations: vi.fn() }));
vi.mock('@/lib/services/manager/organizations', () => ({ listOrganizations }));

vi.mock('@/components/manager/manager-orgs-list', () => ({
  ManagerOrgsList: (props: { orgs: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'orgs-list' }, JSON.stringify(props.orgs)),
}));

import LeaderOrganizationsPage from '@/app/leader/organizations/page';

const SESSION = {
  sub: 'u1',
  role: 'leader' as const,
  companyId: 'c1',
};

describe('LeaderOrganizationsPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    listOrganizations.mockReset();
  });

  it('lists company-wide organizations (teamModeOverride:true) and renders them', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    listOrganizations.mockResolvedValue([{ id: 'org1', name: 'Org' }]);

    const { container } = await renderServerComponent(LeaderOrganizationsPage({ searchParams: Promise.resolve({}) }));

    expect(requireManagerLeader).toHaveBeenCalled();
    // `У-94`: отбор «без ИНН» — четвёртый аргумент, по умолчанию выключен.
    expect(listOrganizations).toHaveBeenCalledWith({}, SESSION, true, { withoutInn: false });
    expect(container.textContent).toContain('Организации');
    expect(container.textContent).toContain('Org');
  });

  it('renders with an empty organizations list', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    listOrganizations.mockResolvedValue([]);

    const { container } = await renderServerComponent(LeaderOrganizationsPage({ searchParams: Promise.resolve({}) }));

    expect(container.textContent).toContain('Организации');
  });
});
