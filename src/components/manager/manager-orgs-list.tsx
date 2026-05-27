import Link from 'next/link';
import type { ManagerOrgListRow } from '@/lib/services/manager/organizations';

/**
 * Presentational table of manager-scoped organizations. Same visual tone as
 * `manager-orders-table` and `partner/portfolio-table`. Counts come from
 * `_count` aggregates, so the row payload is already small (~5 fields).
 */
export function ManagerOrgsList({ orgs }: { orgs: ManagerOrgListRow[] }) {
  if (orgs.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>🏢</span>
        </div>
        <p className='text-gray-500 text-sm'>Вам пока не назначено ни одной организации.</p>
      </div>
    );
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-gray-100 bg-gray-50 text-left'>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Название</th>
            <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Заказы</th>
            <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Сотрудники</th>
            <th className='px-4 py-2.5 font-medium text-gray-600 text-right'></th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((o, i) => (
            <tr
              key={o.id}
              className={`border-b border-gray-50 hover:bg-[#FFF7ED] ${i === orgs.length - 1 ? 'border-b-0' : ''}`}
            >
              <td className='px-4 py-2.5'>
                <Link
                  href={`/manager/organizations/${o.id}`}
                  className='font-medium text-[#111111] hover:text-[#F97316]'
                >
                  {o.name}
                </Link>
              </td>
              <td className='px-4 py-2.5 text-right text-gray-700'>{o._count.orders}</td>
              <td className='px-4 py-2.5 text-right text-gray-700'>{o._count.students}</td>
              <td className='px-4 py-2.5 text-right'>
                <Link
                  href={`/manager/organizations/${o.id}`}
                  className='text-[#F97316] hover:underline text-sm'
                >
                  →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
