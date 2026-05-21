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

export function LeadsCardList({ rows }: { rows: LeadRow[] }) {
  if (rows.length === 0) {
    return (
      <div className='md:hidden bg-white border border-gray-200 rounded-xl p-8 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>✚</span>
        </div>
        <p className='text-gray-500 text-sm'>Заявок пока нет</p>
        <Link
          href='/partner/leads/new'
          className='inline-block mt-3 px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
        >
          Создать заявку
        </Link>
      </div>
    );
  }

  return (
    <div className='md:hidden space-y-2'>
      {rows.map((l) => (
        <Link
          key={l.id}
          href={`/partner/leads/${l.id}`}
          className='block bg-white border border-gray-200 rounded-xl p-3.5 active:bg-[#FFF7ED]'
        >
          <div className='flex items-start justify-between gap-2'>
            <div className='flex-1 min-w-0'>
              <div className='font-medium text-[#111111] truncate'>{l.clientCompanyName}</div>
              <div className='text-xs text-gray-500 truncate mt-0.5'>{l.subject}</div>
            </div>
            <LeadStatusBadge status={l.status} />
          </div>
          <div className='mt-2 flex items-center justify-between text-xs'>
            <span className='text-gray-500'>{l.clientContactName}</span>
            <span className='text-gray-700 font-medium'>{fmtMoney(l.estimatedAmount)}</span>
          </div>
          <div className='mt-1 text-xs text-gray-400'>создана {fmtDate(l.createdAt)}</div>
        </Link>
      ))}
    </div>
  );
}
