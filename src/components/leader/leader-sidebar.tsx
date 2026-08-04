'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/navigation/cabinet';
// ФТ-15.1: меню сотрудников сгруппировано по секциям (как у админа).
import { groupNavItems, splitPinnedItems } from '@/lib/navigation/groupItems';
import { NavBadge } from '@/components/navigation/nav-badge';

export function LeaderSidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  // ТЗ 2026-08-04: «Настройки» — отдельный блок внизу, вне операционных секций.
  const { items: mainItems, pinned } = splitPinnedItems(items);

  const renderItem = (item: NavItem) => {
    const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
            isActive ? 'bg-[#F97316] text-white font-medium' : 'text-gray-700 hover:bg-gray-100'
          }`}
          data-testid={`leader-nav-${item.href.replace(/\//g, '-')}`}
          data-active={isActive ? 'true' : 'false'}
        >
          <span className="text-base">{item.icon}</span>
          <span>{item.label}</span>
          {item.badgeKey && <NavBadge badgeKey={item.badgeKey} />}
        </Link>
      </li>
    );
  };

  return (
    <nav className="w-60 min-h-screen bg-white border-r border-gray-200 p-4 flex-shrink-0">
      <div className="text-lg font-bold text-[#111111] mb-1 px-2">Руководитель</div>
      <div className="text-xs text-gray-500 mb-4 px-2 truncate">Промтехносфера</div>

      {groupNavItems(mainItems).map((group) => (
        <div key={group.title} className={group.title ? 'mb-5' : 'mb-4'}>
          {group.title && (
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500 px-2 mb-2">
              {group.title}
            </div>
          )}
          <ul className="space-y-0.5">{group.items.map(renderItem)}</ul>
        </div>
      ))}
      {pinned.length > 0 && (
        <div className="mt-2 pt-4 border-t border-gray-200" data-testid="leader-sidebar-pinned">
          <ul className="space-y-0.5">{pinned.map(renderItem)}</ul>
        </div>
      )}
    </nav>
  );
}
