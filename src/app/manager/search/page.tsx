import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { globalSearch } from '@/lib/services/search/globalSearch';
import { SearchForm } from '@/components/search/search-form';
import { SearchResults } from '@/components/search/search-results';

export const dynamic = 'force-dynamic';

export default async function ManagerSearchPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!isFeatureEnabled('global_search')) notFound();
  const session = await requireManager();
  const q = ((await searchParams).q ?? '').trim();
  // Короткий/пустой запрос коротим до сервиса (спека §4); too_short внутри — defense-in-depth.
  const result = q.length >= 2 ? await globalSearch(prisma, session, { q }) : null;

  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-bold text-[#111111]'>Поиск</h1>
        <p className='text-sm text-gray-500 mt-1'>
          Единый поиск по заказам, организациям, заявкам, задачам, календарю, документам, слушателям
          и чату команды.
        </p>
      </div>
      <SearchForm action='/manager/search' initialQuery={q} />
      {result === null ? (
        q.length > 0 ? (
          <p className='text-sm text-gray-500'>Введите минимум 2 символа.</p>
        ) : null
      ) : result.ok ? (
        <SearchResults groups={result.groups} query={result.query} />
      ) : result.error === 'too_short' ? (
        <p className='text-sm text-gray-500'>Введите минимум 2 символа.</p>
      ) : (
        <p className='text-sm text-gray-500'>Поиск недоступен.</p>
      )}
    </div>
  );
}
