import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
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
import { LeaderSidebar } from '@/components/leader/leader-sidebar';
import { navByRole } from '@/lib/navigation/cabinet';

describe('LeaderSidebar', () => {
  it('renders 10 nav links from the leader canon, including manager-cabinet bridges and Настройки', () => {
    vi.mocked(usePathname).mockReturnValue('/leader/dashboard');
    const html = renderToString(React.createElement(LeaderSidebar, { items: navByRole.leader }));
    const matches = html.match(/data-testid="leader-nav-/g);
    expect(matches).toHaveLength(10);
    expect(html).toContain('href="/leader/dashboard"');
    expect(html).toContain('href="/leader/team"');
    expect(html).toContain('href="/leader/finance"');
    expect(html).toContain('href="/leader/commission-corrections"');
    expect(html).toContain('href="/leader/orders"');
    expect(html).toContain('href="/leader/organizations"');
    expect(html).toContain('href="/leader/enrollments"');
    expect(html).toContain('href="/manager/messages"');
    expect(html).toContain('href="/manager/dashboard"');
    expect(html).toContain('href="/leader/settings"');
  });

  it('shows the «Руководитель» heading with the Промтехносфера subtitle', () => {
    vi.mocked(usePathname).mockReturnValue('/leader/dashboard');
    const html = renderToString(React.createElement(LeaderSidebar, { items: navByRole.leader }));
    expect(html).toContain('Руководитель');
    expect(html).toContain('Промтехносфера');
    expect(html).not.toContain('>Менеджер<');
  });

  it('marks exactly one link active', () => {
    vi.mocked(usePathname).mockReturnValue('/leader/team');
    const html = renderToString(React.createElement(LeaderSidebar, { items: navByRole.leader }));
    const activeMatches = html.match(/data-active="true"/g);
    expect(activeMatches).toHaveLength(1);
    expect(html).toContain('data-testid="leader-nav--leader-team" data-active="true"');
  });

  it('marks team link active on sub-path /leader/team/abc', () => {
    vi.mocked(usePathname).mockReturnValue('/leader/team/abc');
    const html = renderToString(React.createElement(LeaderSidebar, { items: navByRole.leader }));
    expect(html).toContain('data-testid="leader-nav--leader-team" data-active="true"');
  });

  it('applies orange accent #F97316 on active link', () => {
    vi.mocked(usePathname).mockReturnValue('/leader/orders');
    const html = renderToString(React.createElement(LeaderSidebar, { items: navByRole.leader }));
    const activeTag = html.match(/<a [^>]*data-active="true"[^>]*>/);
    expect(activeTag).not.toBeNull();
    expect(activeTag![0]).toContain('#F97316');
  });
});
