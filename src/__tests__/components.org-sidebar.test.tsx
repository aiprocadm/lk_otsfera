import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams())
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    'data-testid': testId,
    'data-active': dataActive
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    'data-testid'?: string;
    'data-active'?: string;
  }) =>
    React.createElement(
      'a',
      { href, className, 'data-testid': testId, 'data-active': dataActive },
      children
    )
}));

import { usePathname } from 'next/navigation';
import { OrgSidebar, type OrgSidebarMembership } from '@/components/organization/org-sidebar';
import { navByRole, type NavItem } from '@/lib/navigation/cabinet';

// Full 9-item org canon. Flag-filtering (chat/enrollment) is navItemsFor's job server-side;
// here we pass the full list to test OrgSidebar's viewerRole filtering deterministically.
const ALL_ORG_ITEMS: NavItem[] = navByRole.organization;

const SINGLE_ADMIN: OrgSidebarMembership[] = [
  { organizationId: 'org-A', organizationName: 'ООО Заря', roleInOrg: 'admin' }
];

const SINGLE_MEMBER: OrgSidebarMembership[] = [
  { organizationId: 'org-A', organizationName: 'ООО Заря', roleInOrg: 'member' }
];

const SINGLE_LEADER: OrgSidebarMembership[] = [
  { organizationId: 'org-A', organizationName: 'ООО Заря', roleInOrg: 'leader' }
];

const MULTI: OrgSidebarMembership[] = [
  { organizationId: 'org-A', organizationName: 'ООО Заря', roleInOrg: 'admin' },
  { organizationId: 'org-B', organizationName: 'ООО Восход', roleInOrg: 'member' }
];

describe('OrgSidebar', () => {
  it('renders all 9 nav links for admin viewer', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_ADMIN,
        activeOrgId: 'org-A',
        viewerRole: 'admin'
      })
    );
    const matches = html.match(/data-testid="org-nav-/g);
    expect(matches).toHaveLength(9);
    expect(html).toContain('href="/organization/team"');
  });

  it('hides Команда for member viewer (8 links)', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_MEMBER,
        activeOrgId: 'org-A',
        viewerRole: 'member'
      })
    );
    const matches = html.match(/data-testid="org-nav-/g);
    expect(matches).toHaveLength(8);
    expect(html).not.toContain('href="/organization/team"');
  });

  it('shows Команда for leader viewer (9 links)', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_LEADER,
        activeOrgId: 'org-A',
        viewerRole: 'leader'
      })
    );
    const matches = html.match(/data-testid="org-nav-/g);
    expect(matches).toHaveLength(9);
    expect(html).toContain('href="/organization/team"');
  });

  it('marks exactly one link active on /organization/dashboard', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_ADMIN,
        activeOrgId: 'org-A',
        viewerRole: 'admin'
      })
    );
    const activeMatches = html.match(/data-active="true"/g);
    expect(activeMatches).toHaveLength(1);
    expect(html).toContain('data-testid="org-nav--organization-dashboard" data-active="true"');
  });

  it('marks orders link active on sub-path /organization/orders/123', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/orders/123');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_ADMIN,
        activeOrgId: 'org-A',
        viewerRole: 'admin'
      })
    );
    expect(html).toContain('data-testid="org-nav--organization-orders" data-active="true"');
  });

  it('hides org-selector when only one membership', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_ADMIN,
        activeOrgId: 'org-A',
        viewerRole: 'admin'
      })
    );
    expect(html).not.toContain('data-testid="org-selector"');
  });

  it('shows org-selector with all options when >1 membership', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: MULTI,
        activeOrgId: 'org-A',
        viewerRole: 'admin'
      })
    );
    expect(html).toContain('data-testid="org-selector"');
    expect(html).toContain('ООО Заря');
    expect(html).toContain('ООО Восход');
  });
});
