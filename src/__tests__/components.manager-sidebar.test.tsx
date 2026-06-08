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
import { ManagerSidebar } from '@/components/manager/manager-sidebar';

describe('ManagerSidebar', () => {
  it('renders 7 nav links including Загрузка из 1С', () => {
    vi.mocked(usePathname).mockReturnValue('/manager/dashboard');
    const html = renderToString(React.createElement(ManagerSidebar));
    const matches = html.match(/data-testid="manager-nav-/g);
    expect(matches).toHaveLength(7);
    expect(html).toContain('href="/manager/dashboard"');
    expect(html).toContain('href="/manager/orders"');
    expect(html).toContain('href="/manager/organizations"');
    expect(html).toContain('href="/manager/import"');
    expect(html).toContain('href="/manager/documents"');
    expect(html).toContain('href="/manager/students"');
    expect(html).toContain('href="/manager/messages"');
  });

  it('marks exactly one link active', () => {
    vi.mocked(usePathname).mockReturnValue('/manager/orders');
    const html = renderToString(React.createElement(ManagerSidebar));
    const activeMatches = html.match(/data-active="true"/g);
    expect(activeMatches).toHaveLength(1);
    expect(html).toContain('data-testid="manager-nav--manager-orders" data-active="true"');
  });

  it('marks orders link active on sub-path /manager/orders/abc', () => {
    vi.mocked(usePathname).mockReturnValue('/manager/orders/abc');
    const html = renderToString(React.createElement(ManagerSidebar));
    expect(html).toContain('data-testid="manager-nav--manager-orders" data-active="true"');
  });

  it('applies orange accent #F97316 on active link', () => {
    vi.mocked(usePathname).mockReturnValue('/manager/orders');
    const html = renderToString(React.createElement(ManagerSidebar));
    // The active link tag should contain both the brand color and data-active="true"
    const activeTag = html.match(/<a [^>]*data-active="true"[^>]*>/);
    expect(activeTag).not.toBeNull();
    expect(activeTag![0]).toContain('#F97316');
  });
});
