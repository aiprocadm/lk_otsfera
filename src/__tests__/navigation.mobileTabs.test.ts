/**
 * Нижняя панель телефона (`У-15`, этап 3): состав вкладок по кабинетам.
 *
 * Главная проверка — страж: адрес вкладки обязан существовать в меню своей
 * роли. Иначе панель уводила бы в 404, а заметили бы это только на телефоне.
 */
import { describe, it, expect } from 'vitest';
import { MOBILE_TABS, mobileTabsFor } from '@/lib/navigation/mobileTabs';
import { navByRole, type NavItem } from '@/lib/navigation/cabinet';

describe('MOBILE_TABS', () => {
  it('страж: каждый адрес вкладки есть в меню своей роли', () => {
    const broken: string[] = [];
    for (const [role, hrefs] of Object.entries(MOBILE_TABS)) {
      const known = new Set(navByRole[role as keyof typeof navByRole].map((i) => i.href));
      for (const href of hrefs) {
        if (!known.has(href)) broken.push(`${role}: ${href}`);
      }
    }
    expect(broken, 'Вкладка ведёт на адрес, которого нет в меню роли').toEqual([]);
  });

  it('в каждом кабинете не больше четырёх вкладок (пятая — «Ещё»)', () => {
    for (const [role, hrefs] of Object.entries(MOBILE_TABS)) {
      expect(hrefs.length, `${role}: вкладок больше четырёх`).toBeLessThanOrEqual(4);
      expect(hrefs.length, `${role}: вкладок нет вовсе`).toBeGreaterThan(0);
    }
  });

  it('заведены все шесть кабинетов', () => {
    expect(Object.keys(MOBILE_TABS).sort()).toEqual(
      ['admin', 'leader', 'manager', 'organization', 'partner', 'student'].sort()
    );
  });
});

describe('mobileTabsFor', () => {
  const items: NavItem[] = [
    { href: '/partner/dashboard', label: 'Главная', sectionKey: 'dashboard', iconKey: 'dashboard' },
    { href: '/partner/deals', label: 'Заказы', sectionKey: 'orders', iconKey: 'orders' },
    { href: '/partner/documents', label: 'Документы', sectionKey: 'documents', iconKey: 'documents' },
  ];

  it('возвращает пункты в порядке MOBILE_TABS, а не в порядке меню', () => {
    const tabs = mobileTabsFor('partner', items);
    expect(tabs.map((t) => t.href)).toEqual([
      '/partner/dashboard',
      '/partner/deals',
      '/partner/documents',
    ]);
  });

  it('пункт, скрытый флагом или правами, во вкладки не попадает', () => {
    // '/partner/requests' есть в MOBILE_TABS, но его нет в отфильтрованном меню
    // (флаг client_requests выключен) — вкладки не должны вести в 404.
    const tabs = mobileTabsFor('partner', items);
    expect(tabs.some((t) => t.href === '/partner/requests')).toBe(false);
  });

  it('пустое меню даёт пустой список вкладок', () => {
    expect(mobileTabsFor('admin', [])).toEqual([]);
  });

  it('у слушателя одна вкладка', () => {
    const studentItems: NavItem[] = [{ href: '/student', label: 'Обучение', sectionKey: 'learning', iconKey: 'learning' }];
    expect(mobileTabsFor('student', studentItems)).toHaveLength(1);
  });
});
