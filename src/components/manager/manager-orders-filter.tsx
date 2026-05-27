// Server component — pure HTML `<form method="get">` so submit becomes a
// normal navigation to `/manager/orders?...`. No client JS, no useTransition.
// The parent page is responsible for re-rendering with the new searchParams.

const EXECUTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Все этапы' },
  { value: 'pending', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'on_hold', label: 'На паузе' },
  { value: 'completed', label: 'Завершённые' },
  { value: 'cancelled', label: 'Отменённые' }
];

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
    q?: string;
    executionStatus?: string;
    financialStatus?: string;
    organizationId?: string;
  };
};

export function ManagerOrdersFilter({ orgs, initial }: Props) {
  const hasFilter =
    !!initial.q ||
    !!initial.executionStatus ||
    !!initial.financialStatus ||
    !!initial.organizationId;

  return (
    <form
      method='get'
      action='/manager/orders'
      className='bg-white border border-gray-200 rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-2'
    >
      <input
        type='search'
        name='q'
        defaultValue={initial.q ?? ''}
        placeholder='Поиск по названию или номеру заказа…'
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:border-[#F97316]'
      />

      <select
        name='executionStatus'
        defaultValue={initial.executionStatus ?? ''}
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
      >
        {EXECUTION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
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

      <button
        type='submit'
        className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
      >
        Найти
      </button>

      {hasFilter && (
        <a
          href='/manager/orders'
          className='px-3 py-2 text-sm text-gray-600 hover:text-[#F97316]'
        >
          Сбросить
        </a>
      )}
    </form>
  );
}
