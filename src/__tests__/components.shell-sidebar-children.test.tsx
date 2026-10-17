import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import type { NavItem } from '@/lib/navigation/cabinet';

/**
 * Подпункты в боковом меню (этап 7 ТЗ 13.10.2026, `У-313`): под пунктом, с
 * отступом; подсвечен подпункт с точным адресом, раздел — тоже активен.
 */
const path = vi.hoisted(() => ({ current: '/manager/messages/chats' }));
vi.mock('next/navigation', () => ({ usePathname: () => path.current }));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className, ...rest }, children),
}));
vi.mock('@/components/navigation/nav-badge', () => ({ NavBadge: () => null }));

import { Sidebar } from '@/components/shell/sidebar';

const ITEMS: NavItem[] = [
  {
    href: '/manager/messages',
    label: 'Сообщения',
    sectionKey: 'messages',
    iconKey: 'messages',
    group: 'Коммуникации',
    children: [
      { href: '/manager/messages', label: 'Комментарии по заказам' },
      { href: '/manager/messages/chats', label: 'Чаты с клиентами' },
    ],
  },
  {
    href: '/manager/orders',
    label: 'Заказы',
    sectionKey: 'orders',
    iconKey: 'orders',
    group: 'Работа',
    // Один подпункт — не меню, а повтор раздела: не рисуем.
    children: [{ href: '/manager/orders', label: 'Все' }],
  },
];

const render = (linkHref?: (h: string) => string) =>
  renderToString(
    <Sidebar
      items={ITEMS}
      title="Кабинет"
      testIdPrefix="manager"
      {...(linkHref ? { linkHref } : {})}
    />
  );

describe('Sidebar — подпункты', () => {
  it('подпункты под разделом; активен подпункт с точным адресом и сам раздел', () => {
    path.current = '/manager/messages/chats';
    const html = render();
    expect(html).toContain('aria-label="Подразделы: Сообщения"');
    expect(html).toMatch(
      /data-testid="manager-nav--manager-messages-chats" data-active="true">Чаты с клиентами/
    );
    expect(html).toMatch(
      /data-testid="manager-nav--manager-messages" data-active="false">Комментарии по заказам/
    );
    // Раздел «Сообщения» подсвечен и на подразделе.
    expect(html).toMatch(
      /bg-\[#F97316\][^"]*" data-testid="manager-nav--manager-messages" data-active="true"/
    );
    expect(html).not.toContain('Подразделы: Заказы');
  });

  it('на адресе раздела активен первый подпункт; linkHref применяется и к подпунктам', () => {
    path.current = '/manager/messages';
    const html = render((h) => `${h}?org=1`);
    expect(html).toContain('href="/manager/messages/chats?org=1"');
    expect(html).toMatch(
      /data-testid="manager-nav--manager-messages" data-active="true">Комментарии по заказам/
    );
  });
});
