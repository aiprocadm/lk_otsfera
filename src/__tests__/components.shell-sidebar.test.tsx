/**
 * Общий сайдбар всех шести кабинетов (`У-10`…`У-12`, этап 2).
 *
 * Заменяет четыре прежних теста (`admin-sidebar`, `manager-sidebar`,
 * `leader-sidebar` и меню внутри `dashboard-app-shell`): разметка теперь одна,
 * поэтому и проверяется один раз.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import type { NavItem } from '@/lib/navigation/cabinet';

vi.mock('next/navigation', () => ({ usePathname: () => '/manager/orders' }));
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
vi.mock('@/components/navigation/nav-badge', () => ({
  NavBadge: (props: { badgeKey: string }) =>
    React.createElement('span', { 'data-testid': `badge-${props.badgeKey}` }, '!'),
}));

import { Sidebar } from '@/components/shell/sidebar';

const items: NavItem[] = [
  { href: '/manager/dashboard', label: 'Главная', iconKey: 'dashboard' },
  { href: '/manager/orders', label: 'Заказы', iconKey: 'orders', group: 'Работа' },
  {
    href: '/manager/intake',
    label: 'Входящие в работу',
    iconKey: 'intake',
    group: 'Работа',
    badgeKey: 'intake',
  },
  { href: '/manager/settings', label: 'Настройки', iconKey: 'settings', pinnedBottom: true },
];

function render(extra?: Partial<React.ComponentProps<typeof Sidebar>>) {
  return renderToString(
    React.createElement(Sidebar, {
      items,
      title: 'Менеджер',
      subtitle: 'Промтехносфера',
      testIdPrefix: 'manager',
      ...extra,
    })
  );
}

describe('Sidebar (общий каркас)', () => {
  it('У-10: рисует значок раздела, а не серую точку', () => {
    const html = render();
    expect(html).toContain('⌂'); // dashboard
    expect(html).toContain('📋'); // orders
    expect(html).not.toContain('rounded-full bg-gray-300');
  });

  it('У-12: ширина сайдбара — w-60', () => {
    expect(render()).toContain('w-60');
    expect(render()).not.toContain('w-56');
  });

  it('У-13: на телефоне колонка-сайдбар скрыта', () => {
    const html = render();
    expect(html).toContain('hidden md:flex');
    expect(html).toContain('data-variant="desktop"');
  });

  it('вариант panel виден всегда — это меню внутри бургер-панели', () => {
    const html = render({ variant: 'panel' });
    expect(html).toContain('data-variant="panel"');
    expect(html).not.toContain('hidden md:flex');
    expect(html).not.toContain('min-h-screen');
    // Пункты те же — панель не держит вторую разметку меню.
    expect(html).toContain('Заказы');
  });

  it('подсвечивает активный пункт по текущему пути', () => {
    const html = render();
    // /manager/orders активен, /manager/dashboard — нет
    expect(html).toContain('data-active="true"');
    expect(html).toContain('bg-[#F97316] text-white font-medium');
  });

  it('рисует заголовок и подзаголовок кабинета', () => {
    const html = render();
    expect(html).toContain('Менеджер');
    expect(html).toContain('Промтехносфера');
  });

  it('группирует пункты по секциям', () => {
    expect(render()).toContain('Работа');
  });

  it('закреплённые внизу пункты выносит в отдельный блок', () => {
    const html = render();
    expect(html).toContain('manager-sidebar-pinned');
    expect(html).toContain('Настройки');
  });

  it('рисует живой счётчик у пункта с badgeKey', () => {
    expect(render()).toContain('badge-intake');
  });

  it('пункт disabled рисуется без ссылки и с пометкой «скоро»', () => {
    const html = render({
      items: [{ href: '/x', label: 'Скоро будет', iconKey: 'analytics', disabled: true }],
    });
    expect(html).toContain('скоро');
    expect(html).toContain('cursor-not-allowed');
    expect(html).not.toContain('<a href="/x"');
  });

  it('data-testid пунктов берёт префикс кабинета', () => {
    expect(render({ testIdPrefix: 'partner' })).toContain('partner-nav--manager-orders');
  });

  it('слот top рендерится над меню (переключатель организаций)', () => {
    const html = render({ top: React.createElement('div', null, 'ПЕРЕКЛЮЧАТЕЛЬ') });
    expect(html).toContain('ПЕРЕКЛЮЧАТЕЛЬ');
    expect(html.indexOf('ПЕРЕКЛЮЧАТЕЛЬ')).toBeLessThan(html.indexOf('Заказы'));
  });

  it('linkHref переписывает адреса ссылок (org: ?org=…)', () => {
    const html = render({ linkHref: (h) => `${h}?org=o1` });
    expect(html).toContain('/manager/orders?org=o1');
  });

  it('без подзаголовка рендерится отступ, а не пустая строка', () => {
    const html = renderToString(
      React.createElement(Sidebar, { items, title: 'Админ', testIdPrefix: 'admin' })
    );
    expect(html).toContain('Админ');
    expect(html).not.toContain('Промтехносфера');
  });
});
