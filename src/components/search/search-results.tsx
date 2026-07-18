import React from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import type { SearchGroup } from '@/lib/services/search/globalSearch';

/**
 * M6: презентационная выдача глобального поиска — группы категорий со списком
 * хитов. Domain-agnostic (`SearchGroup`/`SearchHit`), поэтому общая для
 * manager/leader страниц (sibling-исключение CLAUDE.md §4).
 */
export function SearchResults({ groups, query }: { groups: SearchGroup[]; query: string }) {
  if (groups.length === 0) {
    return <EmptyState icon='🔎' message={`По запросу «${query}» ничего не найдено`} className='p-8' />;
  }
  return (
    <div className='space-y-6'>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.labelRu}>
          <h2 className='text-sm font-semibold text-[#111111] mb-2'>
            {group.labelRu}
            <span className='ml-2 font-normal text-gray-400'>{group.hits.length}</span>
          </h2>
          <ul className='bg-white border border-gray-200 rounded-xl divide-y divide-gray-100'>
            {group.hits.map((hit) => (
              <li key={hit.id}>
                <Link href={hit.href} className='block px-4 py-3 hover:bg-gray-50'>
                  <div className='flex items-baseline justify-between gap-3'>
                    <span className='text-sm text-[#111111] truncate'>{hit.title}</span>
                    {hit.date ? (
                      <span className='text-xs text-gray-400 shrink-0'>{fmtDate(hit.date)}</span>
                    ) : null}
                  </div>
                  {hit.subtitle ? (
                    <div className='text-xs text-gray-500 truncate mt-0.5'>{hit.subtitle}</div>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
          {group.limited ? (
            <p className='text-xs text-gray-400 mt-1'>Показаны первые {group.hits.length} — уточните запрос</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
