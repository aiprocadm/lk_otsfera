// @vitest-environment jsdom
/**
 * Мобильная навигация (`У-14`…`У-16`, этап 3): бургер, нижняя панель, «Ещё».
 *
 * Диалог — нативный `<dialog>`, в jsdom его `showModal`/`close` не реализованы,
 * поэтому мокаем их так же, как в остальных тестах диалогов (CLAUDE.md §9).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import React from 'react';
import type { NavItem } from '@/lib/navigation/cabinet';

vi.mock('next/navigation', () => ({ usePathname: () => '/partner/deals' }));
// Пропы прокидываем целиком: без этого теряется aria-current и тест подсветки
// проверял бы мок, а не компонент.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { MobileNav } from '@/components/shell/mobile-nav';

const TABS: NavItem[] = [
  { href: '/partner/dashboard', label: 'Главная', iconKey: 'dashboard' },
  { href: '/partner/deals', label: 'Заказы', iconKey: 'orders' },
];

function renderNav(extra?: Partial<React.ComponentProps<typeof MobileNav>>) {
  return render(
    <MobileNav
      tabs={TABS}
      panel={
        <nav>
          <a href="/partner/settings">Настройки</a>
        </nav>
      }
      {...extra}
    />
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('MobileNav', () => {
  it('рисует нижнюю панель с вкладками и пунктом «Ещё»', () => {
    renderNav();
    const bar = screen.getByTestId('mobile-bottom-bar');
    expect(within(bar).getByText('Главная')).toBeTruthy();
    expect(within(bar).getByText('Заказы')).toBeTruthy();
    expect(within(bar).getByText('Ещё')).toBeTruthy();
  });

  it('панель и бургер скрыты на десктопе', () => {
    renderNav();
    expect(screen.getByTestId('mobile-bottom-bar').className).toContain('md:hidden');
    expect(screen.getByTestId('mobile-burger').className).toContain('md:hidden');
  });

  it('подсвечивает активную вкладку по текущему пути', () => {
    renderNav();
    const bar = screen.getByTestId('mobile-bottom-bar');
    const active = within(bar).getByText('Заказы').closest('a');
    expect(active?.getAttribute('aria-current')).toBe('page');
  });

  it('бургер открывает панель с полным меню', () => {
    renderNav();
    expect(document.querySelector('dialog[open]')).toBeNull();

    fireEvent.click(screen.getByTestId('mobile-burger'));

    const dialog = document.querySelector('dialog[open]');
    expect(dialog).not.toBeNull();
    expect(within(dialog as HTMLElement).getByText('Настройки')).toBeTruthy();
  });

  it('«Ещё» открывает ту же панель, что и бургер', () => {
    renderNav();
    fireEvent.click(screen.getByTestId('mobile-tab-more'));
    expect(document.querySelector('dialog[open]')).not.toBeNull();
  });

  it('выбор пункта в панели закрывает её', () => {
    renderNav();
    fireEvent.click(screen.getByTestId('mobile-burger'));
    const dialog = document.querySelector('dialog[open]') as HTMLElement;

    fireEvent.click(within(dialog).getByText('Настройки'));

    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('клик мимо ссылки панель не закрывает', () => {
    renderNav({
      panel: (
        <div>
          <span>просто текст</span>
        </div>
      ),
    });
    fireEvent.click(screen.getByTestId('mobile-burger'));
    const dialog = document.querySelector('dialog[open]') as HTMLElement;

    fireEvent.click(within(dialog).getByText('просто текст'));

    expect(document.querySelector('dialog[open]')).not.toBeNull();
  });

  it('tabQuery дописывается к адресам вкладок (кабинет заказчика)', () => {
    renderNav({ tabQuery: 'org=o1' });
    const bar = screen.getByTestId('mobile-bottom-bar');
    expect(within(bar).getByText('Заказы').closest('a')?.getAttribute('href')).toBe(
      '/partner/deals?org=o1'
    );
  });

  it('тёмная тема даёт светлый бургер на чёрной шапке', () => {
    renderNav({ theme: 'dark' });
    expect(screen.getByTestId('mobile-burger').className).toContain('text-white');
  });
});
