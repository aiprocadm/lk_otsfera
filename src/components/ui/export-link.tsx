import React from 'react';
import { exportHref } from '@/lib/ui/exportHref';

/**
 * Кнопка-ссылка «Выгрузить в Excel» (ФТ-12.2). Строго презентационный примитив
 * поверх `exportHref` — общий для всех кабинетов (исключение из sibling-правила
 * §4: domain-agnostic, знает только base-путь и query-параметры фильтров).
 * Скачивание идёт GET-ссылкой, поэтому это `<a>`, а не `Button`.
 */
export function ExportLink({
  base,
  params,
  label = 'Выгрузить в Excel',
  className = '',
}: {
  base: string;
  params?: Record<string, string | undefined>;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={exportHref(base, params ?? {})}
      className={`text-sm font-medium text-[#F97316] border border-[#F97316] hover:bg-[#FFF7ED] rounded-lg px-4 py-2 self-start ${className}`.trim()}
    >
      {label}
    </a>
  );
}
