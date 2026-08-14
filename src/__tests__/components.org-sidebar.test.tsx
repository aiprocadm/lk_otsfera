// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(() => ({ push })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    'data-testid': testId,
    'data-active': dataActive,
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
    ),
}));

import { usePathname, useSearchParams } from 'next/navigation';
import { OrgSidebar, type OrgSidebarMembership } from '@/components/organization/org-sidebar';
import { navByRole, type NavItem } from '@/lib/navigation/cabinet';

// Full 12-item org canon (этап 3: + «Удостоверения»; этап 5: + «Обращения»). Flag-filtering (chat/enrollment) is navItemsFor's job server-side;
// here we pass the full list to test OrgSidebar's viewerRole filtering deterministically.
const ALL_ORG_ITEMS: NavItem[] = navByRole.organization;

const SINGLE_ADMIN: OrgSidebarMembership[] = [
  { organizationId: 'org-A', organizationName: 'ООО Заря', roleInOrg: 'admin' },
];

const SINGLE_MEMBER: OrgSidebarMembership[] = [
  { organizationId: 'org-A', organizationName: 'ООО Заря', roleInOrg: 'member' },
];

const SINGLE_LEADER: OrgSidebarMembership[] = [
  { organizationId: 'org-A', organizationName: 'ООО Заря', roleInOrg: 'leader' },
];

const MULTI: OrgSidebarMembership[] = [
  { organizationId: 'org-A', organizationName: 'ООО Заря', roleInOrg: 'admin' },
  { organizationId: 'org-B', organizationName: 'ООО Восход', roleInOrg: 'member' },
];

describe('OrgSidebar', () => {
  beforeEach(() => {
    push.mockClear();
    document.cookie = '';
  });

  it('renders all 13 nav links for admin viewer (+«Справка», `У-76`)', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_ADMIN,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
      })
    );
    const matches = html.match(/data-testid="org-nav-/g);
    expect(matches).toHaveLength(13);
    expect(html).toContain('href="/organization/team"');
  });

  it('в выдвижном меню телефона показывает те же пункты (variant=panel)', () => {
    // Тот же список, другой вид: мобильная панель переиспользует сайдбар, а не
    // заводит второй реестр пунктов (`У-16`).
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_ADMIN,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
        variant: 'panel',
      })
    );
    expect(html.match(/data-testid="org-nav-/g)).toHaveLength(13);
  });

  it('hides Команда for member viewer (12 links)', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_MEMBER,
        activeOrgId: 'org-A',
        viewerRole: 'member',
      })
    );
    const matches = html.match(/data-testid="org-nav-/g);
    expect(matches).toHaveLength(12);
    expect(html).not.toContain('href="/organization/team"');
  });

  it('shows Команда for leader viewer (13 links)', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_LEADER,
        activeOrgId: 'org-A',
        viewerRole: 'leader',
      })
    );
    const matches = html.match(/data-testid="org-nav-/g);
    expect(matches).toHaveLength(13);
    expect(html).toContain('href="/organization/team"');
  });

  it('marks exactly one link active on /organization/dashboard', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_ADMIN,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
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
        viewerRole: 'admin',
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
        viewerRole: 'admin',
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
        viewerRole: 'admin',
      })
    );
    expect(html).toContain('data-testid="org-selector"');
    expect(html).toContain('ООО Заря');
    expect(html).toContain('ООО Восход');
  });

  it('appends ?org= to nav link hrefs when there is more than one membership (buildHref branch)', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: MULTI,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
      })
    );
    expect(html).toContain('href="/organization/dashboard?org=org-A"');
  });

  it('onOrgChange: selecting another org sets the org_ctx cookie and pushes ?org=<next>', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    render(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: MULTI,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
      })
    );
    const select = screen.getByTestId('org-selector');
    fireEvent.change(select, { target: { value: 'org-B' } });
    expect(document.cookie).toContain('org_ctx=org-B');
    expect(push).toHaveBeenCalledWith('/organization/dashboard?org=org-B');
  });

  it('falls back to "Организация" when activeOrgId matches no membership', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: SINGLE_ADMIN,
        activeOrgId: 'org-unknown',
        viewerRole: 'admin',
      })
    );
    expect(html).toContain('>Организация<');
  });

  // У-6/У-7 (этап 2): пункта без значка больше не существует — `iconKey`
  // обязателен на уровне типа, значок берётся из реестра `navigation/icons.ts`.
  it('рисует значок раздела из реестра', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/custom');
    const items: NavItem[] = [
      { href: '/organization/custom', label: 'Свой раздел', iconKey: 'documents' },
    ];
    const html = renderToString(
      React.createElement(OrgSidebar, {
        items,
        memberships: SINGLE_ADMIN,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
      })
    );
    expect(html).toContain('Свой раздел');
    expect(html).toContain('📄');
  });

  it('falls back to an empty query string when useSearchParams() returns undefined (buildHref + onOrgChange)', () => {
    vi.mocked(usePathname).mockReturnValue('/organization/dashboard');
    vi.mocked(useSearchParams).mockReturnValueOnce(
      undefined as unknown as ReturnType<typeof useSearchParams>
    );
    render(
      React.createElement(OrgSidebar, {
        items: ALL_ORG_ITEMS,
        memberships: MULTI,
        activeOrgId: 'org-A',
        viewerRole: 'admin',
      })
    );
    expect(screen.getByTestId('org-nav--organization-dashboard').getAttribute('href')).toBe(
      '/organization/dashboard?org=org-A'
    );

    const select = screen.getByTestId('org-selector');
    fireEvent.change(select, { target: { value: 'org-B' } });
    expect(push).toHaveBeenCalledWith('/organization/dashboard?org=org-B');
  });
});
