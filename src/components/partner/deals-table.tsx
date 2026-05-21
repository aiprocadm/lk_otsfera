import Link from 'next/link';
import type { DealRow } from '@/lib/services/partner/deals';
import { DealStatusBadge } from './deal-status-badge';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
}

export function DealsTable({ rows }: { rows: DealRow[] }) {
  if (rows.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>📋</span>
        </div>
        <p className='text-gray-500 text-sm'>По выбранным фильтрам сделок нет</p>
      </div>
    );
  }

  return (
    <div className='hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-gray-100 bg-gray-50 text-left'>
            <th className='px-4 py-2.5 font-medium text-gray-600'>№</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Сделка</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Организация</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Статус</th>
            <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Сумма</th>
            <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Долг</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Срок</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d, i) => (
            <tr
              key={d.id}
              className={`border-b border-gray-50 hover:bg-[#FFF7ED] ${i === rows.length - 1 ? 'border-b-0' : ''}`}
            >
              <td className='px-4 py-2.5 text-gray-500'>{d.orderNumber ?? '—'}</td>
              <td className='px-4 py-2.5'>
                <Link
                  href={`/partner/deals/${d.id}`}
                  className='font-medium text-[#111111] hover:text-[#F97316]'
                >
                  {d.title}
                </Link>
              </td>
              <td className='px-4 py-2.5'>
                {d.organizationId ? (
                  <Link
                    href={`/partner/portfolio/${d.organizationId}`}
                    className='text-gray-600 hover:text-[#F97316]'
                  >
                    {d.organizationName}
                  </Link>
                ) : (
                  <span className='text-gray-500'>{d.organizationName}</span>
                )}
              </td>
              <td className='px-4 py-2.5'>
                <DealStatusBadge stage={d.stage} />
              </td>
              <td className='px-4 py-2.5 text-right text-gray-700'>{fmtMoney(d.totalAmount)}</td>
              <td
                className={`px-4 py-2.5 text-right ${
                  Number(d.debt) > 0 ? 'text-red-700 font-medium' : 'text-gray-500'
                }`}
              >
                {fmtMoney(d.debt)}
              </td>
              <td className='px-4 py-2.5 text-gray-500'>{fmtDate(d.deadline)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
