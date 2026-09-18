import React from 'react';
import Link from 'next/link';

/**
 * Выбор компании для аналитики администратора (`Р-Э7-8`).
 *
 * Ссылками, а не выпадающим списком: страница серверная, и ссылка работает без
 * скрипта, сохраняется в закладках и открывается в новой вкладке. Компаний у
 * учебного центра единицы, списком они читаются лучше.
 */
export function CompanyPicker({
  basePath,
  companies,
  active,
  query,
}: {
  basePath: string;
  companies: Array<{ id: string; name: string }>;
  active: string;
  query?: Record<string, string> | undefined;
}) {
  if (companies.length <= 1) return null;
  return (
    <nav className="flex flex-wrap gap-2 text-sm" data-testid="company-picker">
      {companies.map((c) => {
        const params = new URLSearchParams({ ...(query ?? {}), company: c.id });
        const isActive = c.id === active;
        return (
          <Link
            key={c.id}
            href={`${basePath}?${params.toString()}`}
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? 'rounded-full bg-[#F97316] px-3 py-1 text-white'
                : 'rounded-full bg-[#F3F4F6] px-3 py-1 text-gray-700 hover:bg-gray-200'
            }
          >
            {c.name}
          </Link>
        );
      })}
    </nav>
  );
}
