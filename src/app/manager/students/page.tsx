import Link from 'next/link';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listStudents } from '@/lib/services/manager/students';
import { ManagerStudentsTable } from '@/components/manager/manager-students-table';

type SearchParams = { q?: string; cursor?: string };

export default async function ManagerStudentsPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;

  const { rows, nextCursor } = await listStudents(prisma, {
    session,
    q: sp.q,
    cursor: sp.cursor
  });

  // Preserve current filters on the "next page" link so cursor pagination does
  // not silently drop the user's filter state — same pattern as documents page.
  const nextParams = new URLSearchParams();
  if (sp.q) nextParams.set('q', sp.q);
  if (nextCursor) nextParams.set('cursor', nextCursor);

  return (
    <div className='space-y-4'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Сотрудники</h1>

      <form method='get' className='flex flex-wrap items-center gap-2'>
        <input
          name='q'
          defaultValue={sp.q ?? ''}
          placeholder='Поиск по ФИО или email…'
          className='border border-gray-200 rounded px-2 py-1 text-sm flex-1 min-w-[200px]'
        />
        <button
          type='submit'
          className='px-3 py-1 bg-[#F97316] text-white rounded text-sm hover:bg-[#EA580C]'
        >
          Найти
        </button>
      </form>

      <ManagerStudentsTable rows={rows} />

      {nextCursor && (
        <div>
          <Link
            href={`/manager/students?${nextParams.toString()}`}
            className='inline-block text-sm text-[#F97316] hover:underline'
          >
            Дальше →
          </Link>
        </div>
      )}
    </div>
  );
}
