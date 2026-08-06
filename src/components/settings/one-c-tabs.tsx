'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { tail: 'excel', label: 'Загрузка Excel' },
  { tail: 'payments', label: 'Выписка (сч. 51)' },
];

/**
 * Переключатель вкладок подраздела «Обмен с 1С». С этапа 7 ТЗ импорта у
 * подраздела два дома — админский и хаб руководителя; вкладки строятся от
 * кабинета (дефолт admin — существующие использования не меняются).
 */
export function OneCTabs({ cabinet = 'admin' }: { cabinet?: 'admin' | 'leader' }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Разделы обмена с 1С" className="flex gap-1 border-b border-gray-200">
      {TABS.map(({ tail, label }) => {
        const tab = { href: `/${cabinet}/settings/integrations/1c/${tail}`, label };
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
