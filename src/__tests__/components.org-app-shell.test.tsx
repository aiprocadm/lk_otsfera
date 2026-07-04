import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

const { navItemsFor } = vi.hoisted(() => ({ navItemsFor: vi.fn() }));
vi.mock('@/lib/navigation/cabinet', () => ({ navItemsFor }));

vi.mock('@/components/ui', () => ({
  LogoutButton: () => React.createElement('button', null, 'Выйти')
}));

vi.mock('@/components/organization/org-sidebar', () => ({
  OrgSidebar: (props: { items: Array<{ href: string; label: string }> }) =>
    React.createElement(
      'nav',
      { 'data-testid': 'org-sidebar' },
      props.items.map((item) => React.createElement('span', { key: item.href }, item.label))
    )
}));

import { OrgAppShell } from '@/components/organization/org-app-shell';
import type { OrgSidebarMembership } from '@/components/organization/org-sidebar';

const MEMBERSHIPS: OrgSidebarMembership[] = [
  { organizationId: 'org-A', organizationName: 'ООО Заря', roleInOrg: 'admin' }
];

// React.createElement's overloads require `children` up front when a
// component's props type declares it non-optional. Folding it into the
// props object sidesteps that without resorting to JSX (banned in this
// project's test files — classic runtime) — see the Dialog exemplar.
function renderShell(props: React.ComponentProps<typeof OrgAppShell>) {
  return React.createElement(OrgAppShell, props);
}

describe('OrgAppShell', () => {
  beforeEach(() => {
    navItemsFor.mockReset();
    navItemsFor.mockReturnValue([{ href: '/organization/dashboard', label: 'Главная' }]);
  });

  it('renders the org sidebar via navItemsFor("organization"), header with org name + email, and children', () => {
    const html = renderToString(
      renderShell({
        userEmail: 'org@example.com',
        activeOrgName: 'ООО Заря',
        memberships: MEMBERSHIPS,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
        children: React.createElement('p', null, 'дочерний контент')
      })
    );

    expect(navItemsFor).toHaveBeenCalledWith('organization');
    expect(html).toContain('ООО Заря');
    expect(html).toContain('org@example.com');
    expect(html).toContain('дочерний контент');
    expect(html).toContain('Главная');
    expect(html).toContain('data-testid="org-sidebar"');
  });

  it('omits the email span when userEmail is null/undefined', () => {
    const html = renderToString(
      renderShell({
        userEmail: null,
        activeOrgName: 'ООО Заря',
        memberships: MEMBERSHIPS,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
        children: 'c'
      })
    );
    expect(html).not.toContain('·');
  });
});
