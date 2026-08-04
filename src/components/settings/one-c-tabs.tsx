'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/settings/integrations/1c/excel', label: 'Загрузка Excel' },
  { href: '/admin/settings/integrations/1c/payments', label: 'Выписка (сч. 51)' },
];

/** Переключатель вкладок подраздела «Обмен с 1С». */
export function OneCTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Разделы обмена с 1С" className="flex gap-1 border-b border-gray-200">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-active={active ? 'true' : 'false'}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${
              active
                ? 'border-[#F97316] text-[#111111] font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
