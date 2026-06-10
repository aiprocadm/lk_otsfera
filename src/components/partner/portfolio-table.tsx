import Link from 'next/link';
import type { PortfolioItem } from '@/lib/services/partner/portfolio';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

export function PortfolioTable({ items }: { items: PortfolioItem[] }) {
  if (items.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>🏢</span>
        </div>
        <p className='text-gray-500 text-sm'>Нет организаций по выбранным фильтрам</p>
      </div>
    );
  }

  return (
    <div className='hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-gray-100 bg-gray-50 text-left'>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>Организация</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>ИНН</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600 text-right'>Сделок</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600 text-right'>Долг</th>
          </tr>
        </thead>
        <tbody>
          {items.map((org, i) => (
            <tr key={org.id} className={`border-b border-gray-50 hover:bg-[#FFF7ED] ${i === items.length - 1 ? 'border-b-0' : ''}`}>
              <td className='px-4 py-2.5'>
                <Link href={`/partner/portfolio/${org.id}`} className='font-medium text-[#111111] hover:text-[#F97316]'>
                  {org.name}
                </Link>
              </td>
              <td className='px-4 py-2.5 text-gray-500'>{org.inn ?? '—'}</td>
              <td className='px-4 py-2.5 text-right'>{org.ordersCount}</td>
              <td className={`px-4 py-2.5 text-right ${Number(org.debt) > 0 ? 'text-red-700 font-medium' : 'text-gray-500'}`}>
                {fmtMoney(org.debt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
