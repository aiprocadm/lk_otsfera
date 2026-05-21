import Link from 'next/link';
import type { LeadRow } from '@/lib/services/partner/leads';
import { LeadStatusBadge } from './lead-status-badge';

function fmtMoney(s: string | null): string {
  if (!s) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
}

export function LeadsTable({ rows }: { rows: LeadRow[] }) {
  if (rows.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>✚</span>
        </div>
        <p className='text-gray-500 text-sm'>Заявок пока нет</p>
        <Link
          href='/partner/leads/new'
          className='inline-block mt-3 px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
        >
          Создать первую заявку
        </Link>
      </div>
    );
  }

  return (
    <div className='hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-gray-100 bg-gray-50 text-left'>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Клиент</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Тема</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Контакт</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Статус</th>
            <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Оценка</th>
            <th className='px-4 py-2.5 font-medium text-gray-600'>Создана</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr
              key={l.id}
              className={`border-b border-gray-50 hover:bg-[#FFF7ED] ${i === rows.length - 1 ? 'border-b-0' : ''}`}
            >
              <td className='px-4 py-2.5'>
                <Link
                  href={`/partner/leads/${l.id}`}
                  className='font-medium text-[#111111] hover:text-[#F97316] block'
                >
                  {l.clientCompanyName}
                </Link>
                {l.clientInn && <div className='text-xs text-gray-400'>ИНН {l.clientInn}</div>}
              </td>
              <td className='px-4 py-2.5 text-gray-700 max-w-xs truncate' title={l.subject}>
                {l.subject}
              </td>
              <td className='px-4 py-2.5 text-gray-500'>{l.clientContactName}</td>
              <td className='px-4 py-2.5'>
                <LeadStatusBadge status={l.status} />
              </td>
              <td className='px-4 py-2.5 text-right text-gray-700'>{fmtMoney(l.estimatedAmount)}</td>
              <td className='px-4 py-2.5 text-gray-500'>{fmtDate(l.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
