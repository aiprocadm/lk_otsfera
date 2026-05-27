import Link from 'next/link';
import type { ManagerStudentRow } from '@/lib/services/manager/students';

/**
 * Presentational table of manager-scoped students. Mirrors the visual tone of
 * `manager-orgs-list` (white card, gray header, orange hover). Unlike the
 * organization-cabinet sibling, this view spans multiple orgs, so each row
 * shows the organization name as a clickable link to /manager/organizations/[id].
 */
export function ManagerStudentsTable({ rows }: { rows: ManagerStudentRow[] }) {
  if (rows.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>👥</span>
        </div>
        <p className='text-gray-500 text-sm'>Сотрудники не найдены.</p>
      </div>
    );
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-gray-100 bg-gray-50 text-left'>
            <th className='px-4 py-2.5 font-medium text-gray-600'>ФИО</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Email</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Организация</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>ID сотрудника</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Добавлен</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr
              key={s.id}
              className={`border-b border-gray-50 hover:bg-[#FFF7ED] ${i === rows.length - 1 ? 'border-b-0' : ''}`}
            >
              <td className='px-4 py-2.5 font-medium text-[#111111]'>{s.name}</td>
              <td className='px-4 py-2.5 text-gray-600'>{s.email}</td>
              <td className='px-4 py-2.5'>
                <Link
                  href={`/manager/organizations/${s.organization.id}`}
                  className='text-[#F97316] hover:underline'
                >
                  {s.organization.name}
                </Link>
              </td>
              <td className='px-4 py-2.5 text-gray-500 font-mono text-xs'>
                {s.externalStudentId ?? '—'}
              </td>
              <td className='px-4 py-2.5 text-gray-500'>
                {s.createdAt.toLocaleDateString('ru-RU')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
