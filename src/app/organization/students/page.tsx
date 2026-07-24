import React from 'react';
import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { listOrgStudents, type OrgStudentRow } from '@/lib/services/organization/students';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

type SearchParams = {
  org?: string;
  search?: string;
  take?: string;
  skip?: string;
};

const DEFAULT_TAKE = 50;
const MAX_TAKE = 200;

export default async function OrganizationStudentsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

  const take = Math.min(
    Number.isFinite(Number(sp.take)) ? Number(sp.take) : DEFAULT_TAKE,
    MAX_TAKE
  );
  const skip = Number.isFinite(Number(sp.skip)) ? Number(sp.skip) : 0;

  const { rows, total } = await listOrgStudents(prisma, {
    organizationId: ctx.activeOrgId,
    search: sp.search,
    take,
    skip
  });

  const page = Math.floor(skip / take) + 1;
  const pages = Math.max(1, Math.ceil(total / take));

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className='space-y-4'>
        <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold text-[#111111]'>Сотрудники</h1>
            <p className='text-sm text-gray-500 mt-0.5'>
              {total} {pluralizeStudents(total)} в {ctx.activeOrgName}
              {sp.search && (
                <span className='text-gray-400'> · по запросу «{sp.search}»</span>
              )}
            </p>
          </div>
          <SearchForm initial={sp.search ?? ''} org={sp.org ?? ''} />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon='👥'
            message={
              sp.search
                ? 'По запросу никого не нашли — попробуйте другой текст.'
                : 'У вашей организации пока нет сотрудников на обучении.'
            }
          />
        ) : (
          <StudentsTable rows={rows} linkToCard={isFeatureEnabled('certificates_registry')} />
        )}

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
    </OrgAppShell>
  );
}

function pluralizeStudents(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'сотрудник';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'сотрудника';
  return 'сотрудников';
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(d);
}

function SearchForm({ initial, org }: { initial: string; org: string }) {
  return (
    <form method='get' className='flex gap-2 items-center'>
      {org && <input type='hidden' name='org' value={org} />}
      <input
        type='search'
        name='search'
        defaultValue={initial}
        placeholder='Поиск по ФИО или email…'
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-72 focus:outline-none focus:border-[#F97316]'
      />
      <button
        type='submit'
        className='px-3 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
      >
        Найти
      </button>
    </form>
  );
}

function StudentsTable({ rows, linkToCard }: { rows: OrgStudentRow[]; linkToCard: boolean }) {
  return (
    <TableShell>
      <THead>
        <Th>ФИО</Th>
        <Th>Email</Th>
        <Th>ID студента</Th>
        <Th>Добавлен</Th>
      </THead>
      <tbody>
        {rows.map((s) => (
          <Tr key={s.id}>
            <Td className='font-medium text-[#111111]'>
              {/* Этап 3 (ФТ-6.3): карточка сотрудника — под флагом реестров. */}
              {linkToCard ? (
                <Link href={`/organization/students/${s.id}`} className='hover:text-[#F97316] hover:underline'>
                  {s.name}
                </Link>
              ) : (
                s.name
              )}
            </Td>
            <Td className='text-gray-600'>{s.email}</Td>
            <Td className='text-gray-500 font-mono text-xs'>{s.externalStudentId ?? '—'}</Td>
            <Td className='text-gray-500'>{fmtDate(s.createdAt)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function Paginator({
  take,
  skip,
  page,
  pages,
  total,
  searchParams
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
    if (searchParams.org) params.set('org', searchParams.org);
    if (searchParams.search) params.set('search', searchParams.search);
    params.set('take', String(take));
    if (targetSkip > 0) params.set('skip', String(targetSkip));
    /* v8 ignore next -- `take` is always set above, so params.toString() is never empty; the `? ... : ''` false branch is structurally unreachable */
    return `/organization/students${params.toString() ? '?' + params.toString() : ''}`;
  }
  const prev = Math.max(0, skip - take);
  const next = Math.min((pages - 1) * take, skip + take);
  return (
    <div className='flex items-center justify-between text-sm text-gray-500'>
      <span>
        Страница {page} из {pages} · {total} всего
      </span>
      <div className='flex gap-2'>
        {skip > 0 && (
          <a
            href={link(prev)}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Назад
          </a>
        )}
        {skip + take < total && (
          <a
            href={link(next)}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Вперёд
          </a>
        )}
      </div>
    </div>
  );
}
