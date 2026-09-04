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
  // `У-107`: «Выписка по счёту 51» — одно название везде, включая эту вкладку.
  { tail: 'payments', label: 'Выписка по счёту 51' },
  { tail: 'auto', label: 'Автообмен' },
  // `У-173`: пакет документов для 1С файлом — когда сетевого обмена нет.
  { tail: 'documents', label: 'Выгрузка документов' },
  { tail: 'history', label: 'История' },
] as const;

export function OneCTabs({
  cabinet = 'admin',
  basePath,
  only,
}: {
  cabinet?: 'admin' | 'leader';
  /**
   * `У-113`: у менеджера обмен живёт своим разделом `/manager/exchange`, а не в
   * хабе настроек — хаба у него нет. Вкладки те же, меняется только основание
   * адреса.
   */
  basePath?: string;
  /**
   * Какие вкладки показывать. Менеджеру не дают «Автообмен»: расписаниями
   * управляют администратор и руководитель, а не тот, кто грузит файлы.
   */
  only?: readonly (typeof TABS)[number]['tail'][];
}) {
  const pathname = usePathname();
  const base = basePath ?? `/${cabinet}/settings/integrations/1c`;
  const tabs = only ? TABS.filter((t) => only.includes(t.tail)) : TABS;
  return (
    <nav aria-label="Разделы обмена с 1С" className="flex flex-wrap gap-1 border-b border-gray-200">
      {tabs.map(({ tail, label }) => {
        const href = `${base}/${tail}`;
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
