import React from 'react';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listPartners } from '@/lib/services/admin/partners';
import { PartnersFilters } from '@/components/admin/partners-filters';
import { PartnersTable } from '@/components/admin/partners-table';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type SP = { active?: string; filter?: string; q?: string; skip?: string };

export default async function AdminPartnersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const skip = Number.isFinite(Number(sp.skip)) ? Math.max(0, Number(sp.skip)) : 0;

  const filters = {
    active: sp.active === 'true' ? true : sp.active === 'false' ? false : undefined,
    filter: sp.filter === 'norate' ? ('norate' as const) : undefined,
    q: sp.q?.trim() || undefined,
    take: PAGE_SIZE,
    skip,
  };

  const { rows, total } = await listPartners(prisma, filters);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111111]">Партнёры</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} всего</p>
        </div>
        <Link
          href="/admin/partners/new"
          className="px-3 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]"
        >
          + Создать партнёра
        </Link>
      </div>

      <PartnersFilters active={sp.active} filter={sp.filter} q={sp.q} />

      <PartnersTable rows={rows} />

      {total > PAGE_SIZE && <Paginator skip={skip} take={PAGE_SIZE} total={total} sp={sp} />}
    </div>
  );
}

function Paginator({
  skip,
  take,
  total,
  sp,
}: {
  skip: number;
  take: number;
  total: number;
  sp: SP;
}) {
  function url(s: number): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== 'skip') p.set(k, v);
    if (s > 0) p.set('skip', String(s));
    return `/admin/partners${p.toString() ? '?' + p.toString() : ''}`;
  }
  const page = Math.floor(skip / take) + 1;
  const pages = Math.max(1, Math.ceil(total / take));
  return (
    <div className="flex items-center justify-between text-sm text-gray-500">
      <span>
        Страница {page} из {pages} · {total} всего
      </span>
      <div className="flex gap-2">
        {skip > 0 && (
          <a
            href={url(Math.max(0, skip - take))}
            className="px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50"
          >
            Назад
          </a>
        )}
        {skip + take < total && (
          <a
            href={url(skip + take)}
            className="px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50"
          >
            Вперёд
          </a>
        )}
      </div>
    </div>
  );
}
