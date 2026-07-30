import React from 'react';
import Link from 'next/link';

// Server component — pure HTML `<form method="get">` so submit becomes a
// normal navigation to `${basePath}/orders?...`. No client JS, no useTransition.
// The parent page is responsible for re-rendering with the new searchParams.

// §10 ТЗ v0.5: фильтруем по рабочему статусу из справочника. Прежний фильтр по
// операционному статусу убран вместе с ним из интерфейса (решение Q3) —
// фильтровать по невидимому полю бессмысленно.

const FINANCIAL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Любой финансовый статус' },
  { value: 'not_billed', label: 'Счёт не выставлен' },
  { value: 'billed', label: 'Счёт выставлен' },
  { value: 'partially_paid', label: 'Частично оплачены' },
  { value: 'paid', label: 'Оплачены' },
  { value: 'refunded', label: 'Возврат' }
];

type Props = {
  orgs: Array<{ id: string; name: string }>;
  initial: {
    search?: string;
    statusId?: string;
    financialStatus?: string;
    organizationId?: string;
    unassigned?: string;
  };
  basePath?: string;
  /** §10 ТЗ v0.5: рабочие статусы из справочника для выпадающего списка. */
  statuses?: { id: string; label: string }[];
};

export function ManagerOrdersFilter({ orgs, initial, statuses = [], basePath = '/manager' }: Props) {
  const unassigned = initial.unassigned === '1';
  const hasFilter =
    !!initial.search ||
    !!initial.statusId ||
    !!initial.financialStatus ||
    !!initial.organizationId ||
    unassigned;

  return (
    <form
      method='get'
      action={`${basePath}/orders`}
      className='bg-white border border-gray-200 rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-2'
    >
      <input
        type='search'
        name='search'
        defaultValue={initial.search ?? ''}
        placeholder='Поиск по названию или номеру заказа…'
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:border-[#F97316]'
      />

      <select
        name='statusId'
        defaultValue={initial.statusId ?? ''}
        aria-label='Статус заявки'
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
      >
        <option value=''>Любой статус</option>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        name='financialStatus'
        defaultValue={initial.financialStatus ?? ''}
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
      >
        {FINANCIAL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        name='organizationId'
        defaultValue={initial.organizationId ?? ''}
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
      >
        <option value=''>Все организации</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      <label className='flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 cursor-pointer whitespace-nowrap'>
        <input
          type='checkbox'
          name='unassigned'
          value='1'
          defaultChecked={unassigned}
          className='accent-[#F97316]'
        />
        Без менеджера
      </label>

      <button
        type='submit'
        className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
      >
        Найти
      </button>

      {hasFilter && (
        <Link
          href={`${basePath}/orders`}
          className='px-3 py-2 text-sm text-gray-600 hover:text-[#F97316]'
        >
          Сбросить
        </Link>
      )}
    </form>
  );
}
