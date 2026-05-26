import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type SearchParams = {
  q?: string;
  skip?: string;
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

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { inn: { contains: q, mode: 'insensitive' as const } },
          { externalId: { contains: q, mode: 'insensitive' as const } }
        ]
      }
    : {};

  const [orgs, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      include: {
        partner: { select: { id: true, name: true } },
        _count: { select: { orders: true, organizationUsers: true } }
      },
      orderBy: { name: 'asc' },
      take: PAGE_SIZE,
      skip
    }),
    prisma.organization.count({ where })
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
        <form method='get' className='flex gap-2'>
          <input
            type='search'
            name='q'
            defaultValue={q}
            placeholder='Поиск по названию, ИНН, 1С-id…'
            className='border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-72 focus:outline-none focus:border-[#F97316]'
          />
          <button
            type='submit'
            className='px-3 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
          >
            Найти
          </button>
        </form>
      </div>

      <div className='bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b border-gray-100 bg-gray-50 text-left'>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Название</th>
              <th className='px-4 py-2.5 font-medium text-gray-600'>ИНН</th>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Партнёр</th>
              <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Заказы</th>
              <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Доступ</th>
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 ? (
              <tr>
                <td colSpan={5} className='px-4 py-8 text-center text-gray-500'>
                  Ничего не нашли
                </td>
              </tr>
            ) : (
              orgs.map((o) => (
                <tr key={o.id} className='border-b border-gray-50 hover:bg-[#FFF7ED]'>
                  <td className='px-4 py-2.5 font-medium text-[#111111]'>
                    <Link
                      href={`/admin/organizations/${o.id}`}
                      className='hover:text-[#F97316]'
                    >
                      {o.name}
                    </Link>
                  </td>
                  <td className='px-4 py-2.5 text-gray-500 font-mono text-xs'>
                    {o.inn ?? '—'}
                  </td>
                  <td className='px-4 py-2.5 text-gray-600'>{o.partner.name}</td>
                  <td className='px-4 py-2.5 text-right text-gray-600'>{o._count.orders}</td>
                  <td className='px-4 py-2.5 text-right text-gray-600'>
                    {o._count.organizationUsers}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <Paginator skip={skip} take={PAGE_SIZE} total={total} q={q} />
      )}
    </div>
  );
}

function Paginator({
  skip,
  take,
  total,
  q
}: {
  skip: number;
  take: number;
  total: number;
  q: string;
}) {
  function link(s: number): string {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
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
