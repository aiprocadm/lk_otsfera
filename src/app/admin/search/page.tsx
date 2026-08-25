import React from 'react';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { globalSearch } from '@/lib/services/search/globalSearch';
import { SearchForm } from '@/components/search/search-form';
import { SearchResults } from '@/components/search/search-results';
import { sectionLabel } from '@/lib/navigation/sectionLabels';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

/**
 * Поиск администратора (`У-112`).
 *
 * Прежнее решение `У-75` отдавало поиск только менеджеру и руководителю —
 * администратор, у которого разделов больше всех, искать не мог вовсе. Это
 * сознательное расширение решения, а не дрейф: экран тот же, что у менеджера,
 * а охват режет `searchScopes` (у админа — его компания, Model A).
 */
export default async function AdminSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!isFeatureEnabled('global_search')) notFound();
  const session = await requireAdmin();
  const q = ((await searchParams).q ?? '').trim();
  // Короткий/пустой запрос коротим до сервиса; `too_short` внутри — defense-in-depth.
  const result = q.length >= 2 ? await globalSearch(prisma, session, { q }) : null;

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title={sectionLabel('search')}
          subtitle="Единый поиск по заказам, организациям, заявкам, задачам, календарю, документам, слушателям и чату команды."
        />
      </div>
      <SearchForm action="/admin/search" initialQuery={q} />
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
