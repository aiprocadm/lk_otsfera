// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

/**
 * Этап 11 PR-3 (ФТ-15.5) — нижняя навигация организации на телефоне.
 * Состав вкладок задан ТЗ дословно: Главная · Заказы · Заявки · Документы.
 */

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname }));

import { OrganizationBottomTabBar } from '@/components/organization/bottom-tab-bar';

beforeEach(() => {
  vi.clearAllMocks();
  usePathname.mockReturnValue('/organization/dashboard');
});

describe('OrganizationBottomTabBar', () => {
  it('показывает четыре вкладки состава ФТ-15.5', () => {
    render(<OrganizationBottomTabBar />);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      '⌂Главная',
      '📋Заказы',
      '✚Заявки',
      '📄Документы'
    ]);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/organization/dashboard',
      '/organization/orders',
      '/organization/requests',
      '/organization/documents'
    ]);
  });

  it('текущий раздел помечен aria-current', () => {
    usePathname.mockReturnValue('/organization/orders/abc');
    render(<OrganizationBottomTabBar />);
    const current = screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('href')).toBe('/organization/orders');
  });

  it('на чужом пути активной вкладки нет', () => {
    usePathname.mockReturnValue('/organization/settings');
    render(<OrganizationBottomTabBar />);
    expect(screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current'))).toHaveLength(
      0
    );
  });

  it('панель подписана по-русски и скрыта на десктопе', () => {
    render(<OrganizationBottomTabBar />);
    const nav = screen.getByRole('navigation', { name: 'Мобильная навигация' });
    expect(nav.className).toContain('md:hidden');
  });

  it('неразрешённый путь не роняет панель', () => {
    usePathname.mockReturnValue(null);
    render(<OrganizationBottomTabBar />);
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });
});
