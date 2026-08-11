'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Вкладки экрана «Обмен с 1С» (`У-45`, этап 7).
 *
 * Раньше вкладок было две, а «Автообмен» жил отдельным пунктом меню — человеку
 * приходилось помнить, что обмен с 1С «размазан» по трём местам. Теперь всё
 * здесь, включая общую историю (`У-48`).
 */
const TABS = [
  { tail: 'excel', label: 'Загрузка Excel' },
  { tail: 'payments', label: 'Выписка (сч. 51)' },
  { tail: 'auto', label: 'Автообмен' },
  { tail: 'history', label: 'История' },
] as const;

export function OneCTabs({ cabinet = 'admin' }: { cabinet?: 'admin' | 'leader' }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Разделы обмена с 1С" className="flex flex-wrap gap-1 border-b border-gray-200">
      {TABS.map(({ tail, label }) => {
        const href = `/${cabinet}/settings/integrations/1c/${tail}`;
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
