import React from 'react';
import Link from 'next/link';
import type { Crumb } from '@/lib/navigation/breadcrumbs';

/**
 * Этап 11 PR-2 (ФТ-15.6) — презентационные хлебные крошки.
 *
 * Доступность: `nav[aria-label]` + `ol`; текущая страница — ПОСЛЕДНЯЯ крошка:
 * она помечена `aria-current="page"` и ссылкой не является (`href: null`).
 * Промежуточная крошка без ссылки (группа настроек — не страница) остаётся
 * обычным текстом: `aria-current` в середине цепочки врал бы скринридеру.
 * Разделитель — декоративный, скрыт от скринридера.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Хлебные крошки" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1 text-gray-500">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1">
            {index > 0 && (
              <span aria-hidden="true" className="text-gray-300">
                /
              </span>
            )}
            {item.href ? (
              <Link href={item.href} className="hover:text-[#EA580C] hover:underline">
                {item.label}
              </Link>
            ) : index === items.length - 1 ? (
              <span aria-current="page" className="text-[#111111]">
                {item.label}
              </span>
            ) : (
              <span>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
