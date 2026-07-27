'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/navigation/cabinet';
import { groupNavItems } from '@/lib/navigation/groupItems';

export function AdminSidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  const groups = groupNavItems(items);

  return (
    <nav className="w-60 min-h-screen bg-white border-r border-gray-200 p-4 flex-shrink-0">
      <div className="text-lg font-bold text-[#111111] mb-6 px-2">Админ</div>
      {groups.map((group) => (
        <div key={group.title} className="mb-6">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500 px-2 mb-2">
            {group.title}
          </div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                      isActive
                        ? 'bg-[#F97316] text-white font-medium'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    data-testid={`admin-nav-${item.href.replace(/\//g, '-')}`}
                    data-active={isActive ? 'true' : 'false'}
                  >
                    <span className="text-base">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
