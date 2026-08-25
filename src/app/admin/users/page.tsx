import React from 'react';
import Link from 'next/link';
import type { Role } from '@prisma/client';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listUsers } from '@/lib/services/admin/users';
import { listCompanyOptions } from '@/lib/services/admin/orders';
import { UsersFilters } from '@/components/admin/users-filters';
import { UsersTable } from '@/components/admin/users-table';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type SP = {
  role?: string;
  active?: string;
  q?: string;
  partnerId?: string;
  organizationId?: string;
  companyId?: string;
  skip?: string;
};

function parseRole(v?: string): Role | undefined {
  // `У-119`: `leader` — самостоятельная роль. Без неё фильтр «Руководители»
  // молча превращался в «все роли»: значение приходило и отбрасывалось.
  const allowed = ['admin', 'manager', 'leader', 'partner', 'organization', 'student'];
  return allowed.includes(v ?? '') ? (v as Role) : undefined;
}

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const skip = Number.isFinite(Number(sp.skip)) ? Math.max(0, Number(sp.skip)) : 0;

  const filters = {
    role: parseRole(sp.role),
    active: sp.active === 'true' ? true : sp.active === 'false' ? false : undefined,
    q: sp.q?.trim() || undefined,
    partnerId: sp.partnerId || undefined,
    organizationId: sp.organizationId || undefined,
    companyId: sp.companyId || undefined,
    take: PAGE_SIZE,
    skip,
  };

  const [{ rows, total }, companies] = await Promise.all([
    listUsers(prisma, session, filters),
    listCompanyOptions(prisma),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <PageHeader title="Пользователи" subtitle={<>{total} всего</>} />
        </div>
        <Link
          href="/admin/users/new"
          className="px-3 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]"
        >
          + Пригласить
        </Link>
      </div>

      <UsersFilters
        role={sp.role}
        active={sp.active}
        q={sp.q}
        partnerId={sp.partnerId}
        organizationId={sp.organizationId}
        companyId={sp.companyId}
        companies={companies}
      />

      <UsersTable rows={rows} currentUserId={session.sub} />

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
    return `/admin/users${p.toString() ? '?' + p.toString() : ''}`;
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
