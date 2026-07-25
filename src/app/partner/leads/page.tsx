import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { LeadStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { requirePartner } from '@/lib/auth/requireRole';
import { listLeads } from '@/lib/services/partner/leads';
import { LeadsTable } from '@/components/partner/leads-table';
import { LeadsCardList } from '@/components/partner/leads-card-list';
import { LeadStatusTabs } from '@/components/partner/lead-status-tabs';
import { LeadsSearch } from '@/components/partner/leads-search';

const VALID_STATUS: LeadStatus[] = [
  'new',
  'in_review',
  'qualified',
  'promoted_to_order',
  'rejected'
];

const DEFAULT_TAKE = 25;
const MAX_TAKE = 100;

type SearchParams = { status?: string; search?: string; take?: string; skip?: string };

export default async function PartnerLeadsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  // ФТ-1.7: при включённых обращениях клиентов партнёрские лиды закрыты.
  if (isFeatureEnabled('client_requests')) redirect('/partner/requests');
  const session = await requirePartner();

  const sp = await searchParams;
  const take = Math.min(
    Number.isFinite(Number(sp.take)) ? Number(sp.take) : DEFAULT_TAKE,
    MAX_TAKE
  );
  const skip = Number.isFinite(Number(sp.skip)) ? Number(sp.skip) : 0;

  const status = VALID_STATUS.includes(sp.status as LeadStatus)
    ? (sp.status as LeadStatus)
    : undefined;

  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  const { rows, total, countsByStatus } = await listLeads(prisma, {
    partnerId: session.partnerId,
    scopeOrgIds: scope,
    status,
    search: sp.search,
    take,
    skip
  });

  const page = Math.floor(skip / take) + 1;
  const pages = Math.max(1, Math.ceil(total / take));
  const grandTotal = Object.values(countsByStatus).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <div className='space-y-4'>
      <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>Заявки</h1>
          <p className='text-sm text-gray-500 mt-0.5'>
            {grandTotal} {pluralize(grandTotal, 'заявка', 'заявки', 'заявок')}
            {sp.search && <span className='text-gray-400'> · по запросу «{sp.search}»</span>}
          </p>
        </div>
        <div className='flex gap-2'>
          <LeadsSearch />
          <Link
            href='/partner/leads/new'
            className='inline-flex items-center gap-1.5 px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] whitespace-nowrap'
          >
            <span className='text-lg leading-none'>+</span>
            Новая заявка
          </Link>
        </div>
      </div>

      <LeadStatusTabs active={status} countsByStatus={countsByStatus} search={sp.search} />

      <LeadsTable rows={rows} />
      <LeadsCardList rows={rows} />

      {pages > 1 && (
        <Paginator
          take={take}
          skip={skip}
          page={page}
          pages={pages}
          total={total}
          searchParams={sp}
        />
      )}
    </div>
  );
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function Paginator({
  take, skip, page, pages, total, searchParams
}: {
  take: number;
  skip: number;
  page: number;
  pages: number;
  total: number;
  searchParams: SearchParams;
}) {
  function link(targetSkip: number): string {
    const params = new URLSearchParams();
    if (searchParams.search) params.set('search', searchParams.search);
    if (searchParams.status) params.set('status', searchParams.status);
    params.set('take', String(take));
    if (targetSkip > 0) params.set('skip', String(targetSkip));
    /* v8 ignore next -- `take` is always set above, so params.toString() is never '' here; the ternary's else-branch is unreachable defensive code */
    return `/partner/leads${params.toString() ? '?' + params.toString() : ''}`;
  }

  const prev = Math.max(0, skip - take);
  const next = Math.min((pages - 1) * take, skip + take);

  return (
    <div className='flex items-center justify-between text-sm text-gray-500'>
      <span>Страница {page} из {pages} · {total} всего</span>
      <div className='flex gap-2'>
        {skip > 0 && (
          <a href={link(prev)} className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'>
            Назад
          </a>
        )}
        {skip + take < total && (
          <a href={link(next)} className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'>
            Вперёд
          </a>
        )}
      </div>
    </div>
  );
}
