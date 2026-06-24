import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

// Mock next/navigation usePathname
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

// Mock next/link to render a plain <a> tag so we can inspect hrefs
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
      children,
    ),
}));

import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { navByRole } from '@/lib/navigation/cabinet';

const EXPECTED_HREFS = [
  '/admin/dashboard',
  '/admin/health',
  '/admin/sync',
  '/admin/documents',
  '/admin/messages',
  '/admin/commission-statements',
  '/admin/finance',
  '/admin/import',
  '/admin/enrollments',
  '/admin/audit',
  '/admin/users',
  '/admin/partners',
  '/admin/organizations',
  '/admin/custom-fields',
  '/admin/settings',
];

describe('AdminSidebar', () => {
  it('renders all 14 nav links with correct hrefs', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/dashboard');

    const html = renderToString(React.createElement(AdminSidebar, { items: navByRole.admin }));

    for (const href of EXPECTED_HREFS) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('renders exactly 16 nav links', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/dashboard');

    const html = renderToString(React.createElement(AdminSidebar, { items: navByRole.admin }));

    const matches = html.match(/data-testid="admin-nav-/g);
    expect(matches).toHaveLength(16);
  });

  it('marks exactly one link as active when on /admin/dashboard', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/dashboard');

    const html = renderToString(React.createElement(AdminSidebar, { items: navByRole.admin }));

    const activeMatches = html.match(/data-active="true"/g);
    expect(activeMatches).toHaveLength(1);
    expect(html).toContain('data-testid="admin-nav--admin-dashboard" data-active="true"');
  });

  it('marks exactly one link as active when on /admin/users', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/users');

    const html = renderToString(React.createElement(AdminSidebar, { items: navByRole.admin }));

    const activeMatches = html.match(/data-active="true"/g);
    expect(activeMatches).toHaveLength(1);
    expect(html).toContain('data-testid="admin-nav--admin-users" data-active="true"');
  });

  it('marks users link as active for a sub-path /admin/users/123', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/users/123');

    const html = renderToString(React.createElement(AdminSidebar, { items: navByRole.admin }));

    const activeMatches = html.match(/data-active="true"/g);
    expect(activeMatches).toHaveLength(1);
    expect(html).toContain('data-testid="admin-nav--admin-users" data-active="true"');
  });

  it('renders group titles: Платформа, Операции, Справочники', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/health');

    const html = renderToString(React.createElement(AdminSidebar, { items: navByRole.admin }));

    expect(html).toContain('Платформа');
    expect(html).toContain('Операции');
    expect(html).toContain('Справочники');
  });

  it('marks no link active when pathname does not match any item', () => {
    vi.mocked(usePathname).mockReturnValue('/some/other/page');

    const html = renderToString(React.createElement(AdminSidebar, { items: navByRole.admin }));

    const activeMatches = html.match(/data-active="true"/g);
    expect(activeMatches).toBeNull();
  });
});
