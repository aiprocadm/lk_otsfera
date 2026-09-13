'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Вкладки раздела «Миграция из Битрикс24» (этап 2 ТЗ 12.09.2026, `У-188`):
 * подключение и пакеты — по образцу вкладок «Обмена с 1С». Свой `h1` держит
 * каждая вкладка сама.
 */
const TABS = [
  { tail: '', label: 'Подключение' },
  { tail: 'history', label: 'Пакеты' },
] as const;

const BITRIX_SETTINGS_BASE = '/admin/settings/integrations/bitrix';

export function BitrixTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Разделы миграции из Битрикс24"
      className="flex flex-wrap gap-1 border-b border-gray-200"
    >
      {TABS.map(({ tail, label }) => {
        const href = tail ? `${BITRIX_SETTINGS_BASE}/${tail}` : BITRIX_SETTINGS_BASE;
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            data-active={active ? 'true' : 'false'}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${
              active
                ? 'border-[#F97316] text-[#111111] font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
