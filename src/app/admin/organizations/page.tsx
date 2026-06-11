import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { prisma } from '@/lib/db/prisma';
import { listOrganizations } from '@/lib/services/admin/organizations';
import type { OrgFilters } from '@/lib/services/admin/organizations';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type SearchParams = {
  q?: string;
  skip?: string;
  partnerId?: string;
  withRateOverride?: string;
};

export default async function AdminOrganizationsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const skip = Number.isFinite(Number(sp.skip)) ? Math.max(0, Number(sp.skip)) : 0;
  const partnerId = sp.partnerId || undefined;
  const withRateOverride =
    sp.withRateOverride === 'true' ? true
    : sp.withRateOverride === 'false' ? false
    : undefined;

  const filters: OrgFilters = {
    q: q || undefined,
    partnerId,
    withRateOverride,
    take: PAGE_SIZE,
    skip
  };

  const [{ rows: orgs, total }, partners] = await Promise.all([
    listOrganizations(prisma, filters),
    prisma.partner.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' }
    })
  ]);

  return (
    <div className='space-y-5'>
      <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>Организации</h1>
          <p className='text-sm text-gray-500 mt-0.5'>
            {total} {pluralize(total)} на платформе
            {q && <span className='text-gray-400'> · по запросу «{q}»</span>}
          </p>
        </div>
        <form method='get' className='flex flex-wrap gap-2'>
          <input
            type='search'
            name='q'
            defaultValue={q}
            placeholder='Поиск по названию, ИНН, 1С-id…'
            className='border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-64 focus:outline-none focus:border-[#F97316]'
          />
          <select
            name='partnerId'
            defaultValue={sp.partnerId ?? ''}
            className='border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
          >
            <option value=''>— все партнёры —</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            name='withRateOverride'
            defaultValue={sp.withRateOverride ?? ''}
            className='border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
          >
            <option value=''>— любые —</option>
            <option value='true'>только со ставкой override</option>
            <option value='false'>только без override</option>
          </select>
          <button
            type='submit'
            className='px-3 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
          >
            Найти
          </button>
        </form>
      </div>

      {orgs.length === 0 ? (
        <EmptyState message='Ничего не нашли' className='p-8' />
      ) : (
        <TableShell>
          <THead>
            <Th>Название</Th>
            <Th>ИНН</Th>
            <Th>Партнёр</Th>
            <Th className='text-right'>Заказы</Th>
            <Th className='text-right'>Доступ</Th>
          </THead>
          <tbody>
            {orgs.map((o) => (
              <Tr key={o.id}>
                <Td className='font-medium text-[#111111]'>
                  <Link
                    href={`/admin/organizations/${o.id}`}
                    className='hover:text-[#F97316]'
                  >
                    {o.name}
                  </Link>
                  {o.partnerCommissionRate !== null && (
                    <span
                      title='Ставка override задана'
                      className='ml-1.5 text-[#F97316] text-xs'
                    >
                      ●
                    </span>
                  )}
                </Td>
                <Td className='text-gray-500 font-mono text-xs'>{o.inn ?? '—'}</Td>
                <Td className='text-gray-600'>{o.partner?.name ?? 'Без партнёра'}</Td>
                <Td className='text-right text-gray-600'>{o.ordersCount}</Td>
                <Td className='text-right text-gray-600'>{o.organizationUsersCount}</Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {total > PAGE_SIZE && (
        <Paginator
          skip={skip}
          take={PAGE_SIZE}
          total={total}
          q={q}
          partnerId={sp.partnerId ?? ''}
          withRateOverride={sp.withRateOverride ?? ''}
        />
      )}
    </div>
  );
}

function Paginator({
  skip,
  take,
  total,
  q,
  partnerId,
  withRateOverride
}: {
  skip: number;
  take: number;
  total: number;
  q: string;
  partnerId: string;
  withRateOverride: string;
}) {
  function link(s: number): string {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (partnerId) p.set('partnerId', partnerId);
    if (withRateOverride) p.set('withRateOverride', withRateOverride);
    if (s > 0) p.set('skip', String(s));
    return `/admin/organizations${p.toString() ? '?' + p.toString() : ''}`;
  }
  const page = Math.floor(skip / take) + 1;
  const pages = Math.max(1, Math.ceil(total / take));
  return (
    <div className='flex items-center justify-between text-sm text-gray-500'>
      <span>
        Страница {page} из {pages} · {total} всего
      </span>
      <div className='flex gap-2'>
        {skip > 0 && (
          <a
            href={link(Math.max(0, skip - take))}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Назад
          </a>
        )}
        {skip + take < total && (
          <a
            href={link(skip + take)}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Вперёд
          </a>
        )}
      </div>
    </div>
  );
}

function pluralize(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'организация';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'организации';
  return 'организаций';
}
