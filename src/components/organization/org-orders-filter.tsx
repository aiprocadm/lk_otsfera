'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useState, useTransition } from 'react';

const EXECUTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Все этапы' },
  { value: 'pending', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'on_hold', label: 'На паузе' },
  { value: 'completed', label: 'Завершённые' },
  { value: 'cancelled', label: 'Отменённые' }
];

const FINANCIAL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Любой статус оплаты' },
  { value: 'not_billed', label: 'Счёт не выставлен' },
  { value: 'billed', label: 'Счёт выставлен' },
  { value: 'partially_paid', label: 'Частично оплачены' },
  { value: 'paid', label: 'Оплачены' },
  { value: 'refunded', label: 'Возврат' }
];

export function OrgOrdersFilter() {
  const router = useRouter();
  const sp = useSearchParams();
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const [execution, setExecution] = useState(sp.get('execution') ?? '');
  const [financial, setFinancial] = useState(sp.get('financial') ?? '');
  const [isPending, startTransition] = useTransition();

  function apply(next?: { search?: string; execution?: string; financial?: string }) {
    const params = new URLSearchParams();
    const orgParam = sp.get('org');
    if (orgParam) params.set('org', orgParam);
    const s = next?.search ?? search;
    const e = next?.execution ?? execution;
    const f = next?.financial ?? financial;
    if (s) params.set('search', s);
    if (e) params.set('execution', e);
    if (f) params.set('financial', f);
    startTransition(() => router.replace(`/organization/orders?${params.toString()}`));
  }

  function reset() {
    setSearch('');
    setExecution('');
    setFinancial('');
    const orgParam = sp.get('org');
    const url = orgParam
      ? `/organization/orders?org=${encodeURIComponent(orgParam)}`
      : '/organization/orders';
    startTransition(() => router.replace(url));
  }

  const hasFilter = search || execution || financial;

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-2'>
      <input
        type='search'
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply();
        }}
        placeholder='Поиск по названию или номеру заказа…'
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:border-[#F97316]'
      />

      <select
        value={execution}
        onChange={(e) => {
          setExecution(e.target.value);
          apply({ execution: e.target.value });
        }}
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
      >
        {EXECUTION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <select
        value={financial}
        onChange={(e) => {
          setFinancial(e.target.value);
          apply({ financial: e.target.value });
        }}
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
      >
        {FINANCIAL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <button
        type='button'
        onClick={() => apply()}
        disabled={isPending}
        className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
      >
        Найти
      </button>

      {hasFilter && (
        <button
          type='button'
          onClick={reset}
          disabled={isPending}
          className='px-3 py-2 text-sm text-gray-600 hover:text-[#F97316]'
        >
          Сбросить
        </button>
      )}
    </div>
  );
}
