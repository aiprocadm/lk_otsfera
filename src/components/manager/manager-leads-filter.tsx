import React from 'react';
import Link from 'next/link';

const TABS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Все' },
  { value: 'new', label: 'Новые' },
  { value: 'in_review', label: 'На рассмотрении' },
  { value: 'qualified', label: 'Квалифицированы' },
  { value: 'promoted_to_order', label: 'Стали заказом' },
  { value: 'rejected', label: 'Отклонены' }
];

type Query = { status?: string; q?: string; assignedToMe?: string };

function href(q: Query, patch: Partial<Query>): string {
  const merged = { ...q, ...patch };
  const params = new URLSearchParams();
  if (merged.status) params.set('status', merged.status);
  if (merged.q) params.set('q', merged.q);
  if (merged.assignedToMe) params.set('assignedToMe', merged.assignedToMe);
  const qs = params.toString();
  return qs ? `/manager/leads?${qs}` : '/manager/leads';
}

export function ManagerLeadsFilter({ query }: { query: Query }) {
  const active = query.status ?? '';
  const mine = query.assignedToMe === '1';
  return (
    <div className='mb-4 space-y-3'>
      <div className='flex flex-wrap gap-2'>
        {TABS.map((t) => (
          <Link
            key={t.value || 'all'}
            href={href({ q: query.q, assignedToMe: query.assignedToMe }, { status: t.value })}
            className={`px-3 py-1 text-sm rounded-full border ${
              active === t.value
                ? 'bg-[#F97316] text-white border-[#F97316]'
                : 'border-gray-200 text-gray-700 hover:border-[#F97316]'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <div className='flex items-center gap-3'>
        <form method='get' action='/manager/leads' className='flex gap-2'>
          {query.status && <input type='hidden' name='status' value={query.status} />}
          {mine && <input type='hidden' name='assignedToMe' value='1' />}
          <input
            type='text'
            name='q'
            defaultValue={query.q ?? ''}
            placeholder='Поиск: клиент, тема, ИНН'
            className='px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-64'
          />
          <button type='submit' className='px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:border-[#F97316]'>
            Найти
          </button>
        </form>
        <Link
          href={href({ status: query.status, q: query.q }, { assignedToMe: mine ? '' : '1' })}
          className={`px-3 py-1.5 text-sm rounded-lg border ${
            mine ? 'bg-[#FFF7ED] text-[#9A3412] border-[#FED7AA]' : 'border-gray-200 text-gray-700 hover:border-[#F97316]'
          }`}
        >
          {mine ? '✓ Мои заявки' : 'Мои заявки'}
        </Link>
      </div>
    </div>
  );
}
