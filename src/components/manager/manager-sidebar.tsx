'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = { href: string; label: string; icon: string };

const ITEMS: NavItem[] = [
  { href: '/manager/dashboard', label: 'Главная', icon: '⌂' },
  { href: '/manager/orders', label: 'Заказы', icon: '📋' },
  { href: '/manager/organizations', label: 'Организации', icon: '🏢' },
  { href: '/manager/import', label: 'Загрузка из 1С', icon: '📥' },
  { href: '/manager/documents', label: 'Документы', icon: '📄' },
  { href: '/manager/students', label: 'Сотрудники', icon: '👥' },
  { href: '/manager/messages', label: 'Сообщения', icon: '💬' }
];

export function ManagerSidebar() {
  const pathname = usePathname();

  return (
    <nav className='w-60 min-h-screen bg-white border-r border-gray-200 p-4 flex-shrink-0'>
      <div className='text-lg font-bold text-[#111111] mb-1 px-2'>Менеджер</div>
      <div className='text-xs text-gray-500 mb-4 px-2 truncate'>Промтехносфера</div>

      <ul className='space-y-0.5'>
        {ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                  isActive
                    ? 'bg-[#F97316] text-white font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                data-testid={`manager-nav-${item.href.replace(/\//g, '-')}`}
                data-active={isActive ? 'true' : 'false'}
              >
                <span className='text-base'>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
