import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { globalSearch } from '@/lib/services/search/globalSearch';
import { SearchForm } from '@/components/search/search-form';
import { SearchResults } from '@/components/search/search-results';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function LeaderSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!isFeatureEnabled('global_search')) notFound();
  const session = await requireManagerLeader();
  const q = ((await searchParams).q ?? '').trim();
  // teamModeOverride — как у списков лидера (leader/orders): вся компания.
  const result =
    q.length >= 2 ? await globalSearch(prisma, session, { q, teamModeOverride: true }) : null;

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Поиск"
          subtitle="Единый поиск по заказам, организациям, заявкам, задачам, календарю, документам, слушателям и чату команды."
        />
      </div>
      <SearchForm action="/leader/search" initialQuery={q} />
      {result === null ? (
        q.length > 0 ? (
          <p className="text-sm text-gray-500">Введите минимум 2 символа.</p>
        ) : null
      ) : result.ok ? (
        <SearchResults groups={result.groups} query={result.query} />
      ) : result.error === 'too_short' ? (
        <p className="text-sm text-gray-500">Введите минимум 2 символа.</p>
      ) : (
        <p className="text-sm text-gray-500">Поиск недоступен.</p>
      )}
    </div>
  );
}
