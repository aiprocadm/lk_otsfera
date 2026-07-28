'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Этап 11 PR-3 (Модуль 15, ФТ-15.5) — нижняя навигация организации на телефоне.
 *
 * Sibling партнёрской панели, а НЕ общий компонент (CLAUDE.md §4): состав
 * вкладок у кабинетов разный и будет расходиться дальше. ТЗ задаёт состав
 * дословно: Главная · Заказы · Заявки · Документы.
 */

type Tab = { href: string; label: string; icon: string };

const TABS: Tab[] = [
  { href: '/organization/dashboard', label: 'Главная', icon: '⌂' },
  { href: '/organization/orders', label: 'Заказы', icon: '📋' },
  { href: '/organization/requests', label: 'Заявки', icon: '✚' },
  { href: '/organization/documents', label: 'Документы', icon: '📄' }
];

export function OrganizationBottomTabBar() {
  // `?? ''` — путь может быть ещё не разрешён на серверном проходе оболочки
  // кабинета (страницы org оборачиваются в OrgAppShell сами). Без этого панель
  // роняет весь shell вместо того, чтобы просто не подсветить вкладку.
  const pathname = usePathname() ?? '';

  return (
    <nav
      aria-label='Мобильная навигация'
      className='fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 grid grid-cols-4 md:hidden'
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 h-14 text-xs font-medium ${
              active ? 'text-[#F97316]' : 'text-gray-600 active:bg-[#FFF7ED]'
            }`}
          >
            <span className='text-lg leading-none'>{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
