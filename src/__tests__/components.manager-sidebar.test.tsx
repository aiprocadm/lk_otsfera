import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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
import { navByRole, navItemsFor } from '@/lib/navigation/cabinet';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.FEATURE_MANAGER_CABINET;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('ManagerSidebar', () => {
  it('renders 21 nav links including Поиск, Лиды, Обращения клиентов, Воронка, Задачи, Календарь, Заявки на обучение, Обращения, Звонки, Финансы, Команда, Кабинет руководителя и Настройки (from raw canon)', () => {
    vi.mocked(usePathname).mockReturnValue('/manager/dashboard');
    const html = renderToString(React.createElement(ManagerSidebar, { items: navByRole.manager }));
    const matches = html.match(/data-testid="manager-nav-/g);
    expect(matches).toHaveLength(21);
    expect(html).toContain('href="/manager/dashboard"');
    expect(html).toContain('href="/manager/search"');
    expect(html).toContain('href="/manager/orders"');
    expect(html).toContain('href="/manager/leads"');
    expect(html).toContain('href="/manager/requests"');
    expect(html).toContain('href="/manager/funnel"');
    expect(html).toContain('href="/manager/tasks"');
    expect(html).toContain('href="/manager/calendar"');
    expect(html).toContain('href="/manager/enrollments"');
    expect(html).toContain('href="/manager/organizations"');
    expect(html).toContain('href="/manager/finance"');
    expect(html).toContain('href="/manager/import"');
    expect(html).toContain('href="/manager/payments-import"');
    expect(html).toContain('href="/manager/documents"');
    expect(html).toContain('href="/manager/students"');
    expect(html).toContain('href="/manager/messages"');
    expect(html).toContain('href="/manager/inbox"');
    expect(html).toContain('href="/manager/calls"');
    expect(html).toContain('href="/manager/team"');
    expect(html).toContain('href="/leader/dashboard"');
    expect(html).toContain('href="/manager/settings"');
  });

  it('marks exactly one link active', () => {
    vi.mocked(usePathname).mockReturnValue('/manager/orders');
    const html = renderToString(React.createElement(ManagerSidebar, { items: navByRole.manager }));
    const activeMatches = html.match(/data-active="true"/g);
    expect(activeMatches).toHaveLength(1);
    expect(html).toContain('data-testid="manager-nav--manager-orders" data-active="true"');
  });

  it('marks orders link active on sub-path /manager/orders/abc', () => {
    vi.mocked(usePathname).mockReturnValue('/manager/orders/abc');
    const html = renderToString(React.createElement(ManagerSidebar, { items: navByRole.manager }));
    expect(html).toContain('data-testid="manager-nav--manager-orders" data-active="true"');
  });

  it('applies orange accent #F97316 on active link', () => {
    vi.mocked(usePathname).mockReturnValue('/manager/orders');
    const html = renderToString(React.createElement(ManagerSidebar, { items: navByRole.manager }));
    // The active link tag should contain both the brand color and data-active="true"
    const activeTag = html.match(/<a [^>]*data-active="true"[^>]*>/);
    expect(activeTag).not.toBeNull();
    expect(activeTag![0]).toContain('#F97316');
  });

  it('у рядового менеджера нет «Команда», у руководителя — есть', () => {
    process.env.FEATURE_MANAGER_CABINET = '1';
    const plain = navItemsFor('manager').map((i) => i.label);
    const leader = navItemsFor('manager', { isManagerLeader: true }).map((i) => i.label);
    expect(plain).not.toContain('Команда');
    expect(leader).toContain('Команда');
    expect(plain).toContain('Финансы');
  });
});
