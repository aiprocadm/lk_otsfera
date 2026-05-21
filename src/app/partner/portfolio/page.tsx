import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { listPortfolio } from '@/lib/services/partner/portfolio';
import { PortfolioSearch } from '@/components/partner/portfolio-search';
import { PortfolioTable } from '@/components/partner/portfolio-table';
import { PortfolioCardList } from '@/components/partner/portfolio-card-list';

type SearchParams = { search?: string; take?: string; skip?: string };

const DEFAULT_TAKE = 20;
const MAX_TAKE = 100;

export default async function PortfolioPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session?.partnerId) redirect('/login');

  const sp = await searchParams;
  const take = Math.min(
    Number.isFinite(Number(sp.take)) ? Number(sp.take) : DEFAULT_TAKE,
    MAX_TAKE
  );
  const skip = Number.isFinite(Number(sp.skip)) ? Number(sp.skip) : 0;
  const search = sp.search ?? undefined;

  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  const { items, total } = await listPortfolio(prisma, {
    partnerId: session.partnerId,
    scopeOrgIds: scope,
    search,
    take,
    skip
  });

  const page = Math.floor(skip / take) + 1;
  const pages = Math.max(1, Math.ceil(total / take));

  return (
    <div className='space-y-4'>
      <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>Портфель</h1>
          <p className='text-sm text-gray-500 mt-0.5'>
            {total} {total === 1 ? 'организация' : total < 5 ? 'организации' : 'организаций'}
          </p>
        </div>
        <PortfolioSearch />
      </div>

      <PortfolioTable items={items} />
      <PortfolioCardList items={items} />

      {pages > 1 && (
        <Paginator total={total} take={take} skip={skip} page={page} pages={pages} search={search} />
      )}
    </div>
  );
}

function Paginator({
  total, take, skip, page, pages, search
}: { total: number; take: number; skip: number; page: number; pages: number; search?: string }) {
  function link(targetSkip: number): string {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('take', String(take));
    if (targetSkip > 0) params.set('skip', String(targetSkip));
    return `/partner/portfolio${params.toString() ? '?' + params.toString() : ''}`;
  }

  const prev = Math.max(0, skip - take);
  const next = Math.min((pages - 1) * take, skip + take);

  return (
    <div className='flex items-center justify-between text-sm text-gray-500'>
      <span>Страница {page} из {pages} · {total} всего</span>
      <div className='flex gap-2'>
        {skip > 0 && <a href={link(prev)} className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'>Назад</a>}
        {skip + take < total && <a href={link(next)} className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'>Вперёд</a>}
      </div>
    </div>
  );
}
