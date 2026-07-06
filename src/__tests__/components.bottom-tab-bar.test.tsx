import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}));

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement('a', { href, className }, children)
}));

import { usePathname } from 'next/navigation';
import { BottomTabBar } from '@/components/partner/bottom-tab-bar';

describe('BottomTabBar', () => {
  it('renders all 4 tabs as links with icons and labels', () => {
    vi.mocked(usePathname).mockReturnValue('/partner/dashboard');
    const html = renderToString(React.createElement(BottomTabBar));
    expect(html).toContain('href="/partner/dashboard"');
    expect(html).toContain('href="/partner/deals"');
    expect(html).toContain('href="/partner/leads"');
    expect(html).toContain('href="/partner/documents"');
    expect(html).toContain('Главная');
    expect(html).toContain('Заказы');
  });

  it('marks the active tab with the brand accent color', () => {
    vi.mocked(usePathname).mockReturnValue('/partner/deals');
    const html = renderToString(React.createElement(BottomTabBar));
    expect(html).toContain('text-[#F97316]');
  });

  it('marks a sub-path as active on its parent tab', () => {
    vi.mocked(usePathname).mockReturnValue('/partner/deals/abc123');
    const html = renderToString(React.createElement(BottomTabBar));
    const match = html.match(/<a href="\/partner\/deals"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('text-[#F97316]');
  });

  it('inactive tabs use the muted gray classes', () => {
    vi.mocked(usePathname).mockReturnValue('/partner/dashboard');
    const html = renderToString(React.createElement(BottomTabBar));
    const match = html.match(/<a href="\/partner\/leads"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('text-gray-600');
  });
});
