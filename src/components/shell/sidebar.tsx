'use client';

import React, { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/navigation/cabinet';
import { navIcon } from '@/lib/navigation/icons';
import { groupNavItems, splitPinnedItems } from '@/lib/navigation/groupItems';
import { NavBadge } from '@/components/navigation/nav-badge';

/**
 * Общий сайдбар всех шести кабинетов (`У-11`, этап 2 ТЗ понятности).
 *
 * До этапа 2 сайдбаров было пять, и они разошлись: у партнёра вместо значка
 * рисовалась серая точка, ширина была `w-56` против `w-60`, а подсветки
 * активного пункта не было вовсе. Здесь собрано объединение всех возможностей —
 * группы, закреплённые внизу пункты, живые счётчики, значок, подсветка,
 * пункты «скоро».
 *
 * **Прав тут нет.** Фильтрация по ролям и флагам остаётся на сервере
 * (`navItemsFor`, `hasAnySettingsAccess`, `orgAdminOrLeaderOnly`) — сюда
 * приходит готовый список (CLAUDE.md §4).
 */
export function Sidebar(props: {
  items: NavItem[];
  title: string;
  subtitle?: string;
  /** Префикс `data-testid` пунктов: `admin` → `admin-nav-...`. */
  testIdPrefix: string;
  /** Слот над меню — переключатель организаций в кабинете заказчика. */
  top?: ReactNode;
  /** Кабинет заказчика дописывает к ссылке `?org=…`; остальные — как есть. */
  linkHref?: (href: string) => string;
}) {
  const pathname = usePathname();
  const { items: mainItems, pinned } = splitPinnedItems(props.items);

  const renderItem = (item: NavItem) => {
    if (item.disabled) {
      return (
        <li key={item.href}>
          <div
            className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-gray-300 cursor-not-allowed"
            title="Доступно в следующей фазе"
            data-testid={`${props.testIdPrefix}-nav-${item.href.replace(/\//g, '-')}`}
          >
            <span className="text-base">{navIcon(item.iconKey)}</span>
            <span>{item.label}</span>
            <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-300 bg-gray-50 px-1.5 py-0.5 rounded">
              скоро
            </span>
          </div>
        </li>
      );
    }

    const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
    return (
      <li key={item.href}>
        <Link
          href={props.linkHref ? props.linkHref(item.href) : item.href}
          className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
            isActive ? 'bg-[#F97316] text-white font-medium' : 'text-gray-700 hover:bg-gray-100'
          }`}
          data-testid={`${props.testIdPrefix}-nav-${item.href.replace(/\//g, '-')}`}
          data-active={isActive ? 'true' : 'false'}
        >
          <span className="text-base">{navIcon(item.iconKey)}</span>
          <span>{item.label}</span>
          {item.badgeKey && <NavBadge badgeKey={item.badgeKey} />}
        </Link>
      </li>
    );
  };

  return (
    <nav className="w-60 min-h-screen bg-white border-r border-gray-200 p-4 flex-shrink-0">
      <div className="text-lg font-bold text-[#111111] mb-1 px-2">{props.title}</div>
      {props.subtitle ? (
        <div className="text-xs text-gray-500 mb-4 px-2 truncate">{props.subtitle}</div>
      ) : (
        <div className="mb-4" />
      )}

      {props.top}

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
        <div
          className="mt-2 pt-4 border-t border-gray-200"
          data-testid={`${props.testIdPrefix}-sidebar-pinned`}
        >
          <ul className="space-y-0.5">{pinned.map(renderItem)}</ul>
        </div>
      )}
    </nav>
  );
}
