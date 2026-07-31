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
      children
    ),
}));

import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { navByRole } from '@/lib/navigation/cabinet';

const EXPECTED_HREFS = [
  '/admin/dashboard',
  '/admin/health',
  '/admin/integrations',
  '/admin/sync',
  '/admin/documents',
  '/admin/messages',
  '/admin/commission-statements',
  '/admin/commission-corrections',
  '/admin/finance',
  '/admin/import',
  '/admin/payments-import',
  '/admin/enrollments',
  '/admin/requests',
  '/admin/audit',
  '/admin/pii-access',
  '/admin/users',
  '/admin/partners',
  '/admin/organizations',
  '/admin/custom-fields',
  '/admin/roles',
  '/admin/settings',
];

describe('AdminSidebar', () => {
  it('renders nav links with correct hrefs', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/dashboard');

    const html = renderToString(React.createElement(AdminSidebar, { items: navByRole.admin }));

    for (const href of EXPECTED_HREFS) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('renders exactly 24 nav links', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/dashboard');

    const html = renderToString(React.createElement(AdminSidebar, { items: navByRole.admin }));

    const matches = html.match(/data-testid="admin-nav-/g);
    expect(matches).toHaveLength(24);
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

  it('renders group titles: Платформа, Операции, Обмен с 1С, Справочники', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/health');

    const html = renderToString(React.createElement(AdminSidebar, { items: navByRole.admin }));

    expect(html).toContain('Платформа');
    expect(html).toContain('Операции');
    expect(html).toContain('Обмен с 1С');
    expect(html).toContain('Справочники');
  });

  it('groups all three 1С channels (sync + both imports) under a single "Обмен с 1С" section', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/sync');

    const oneCItems = navByRole.admin.filter((i) => i.group === 'Обмен с 1С').map((i) => i.href);
    expect(oneCItems).toEqual(['/admin/sync', '/admin/import', '/admin/payments-import']);
  });

  it('marks no link active when pathname does not match any item', () => {
    vi.mocked(usePathname).mockReturnValue('/some/other/page');

    const html = renderToString(React.createElement(AdminSidebar, { items: navByRole.admin }));

    const activeMatches = html.match(/data-active="true"/g);
    expect(activeMatches).toBeNull();
  });

  it('groups an item without a `group` under an untitled ("") group instead of throwing', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/ungrouped');

    const html = renderToString(
      React.createElement(AdminSidebar, {
        items: [{ href: '/admin/ungrouped', label: 'Без группы', icon: '?' }],
      })
    );

    expect(html).toContain('Без группы');
    expect(html).toContain('data-testid="admin-nav--admin-ungrouped"');
  });
});
