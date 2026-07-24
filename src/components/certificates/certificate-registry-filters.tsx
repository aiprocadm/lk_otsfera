import React from 'react';

/**
 * GET-форма фильтров реестра удостоверений (этап 3, ФТ-6.1/6.2): направление,
 * статус, поиск по ФИО; у партнёра — плюс организация. Без клиентского JS —
 * обычный submit (образец — SearchForm сотрудников организации).
 */

export const CERTIFICATE_STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'active', label: 'Действует' },
  { value: 'expiring', label: 'Истекает (≤ 60 дней)' },
  { value: 'expired', label: 'Истекло' }
] as const;

const selectCls =
  'border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#F97316]';

export function CertificateRegistryFilters({
  directions,
  organizations = null,
  current,
  hidden = {}
}: {
  directions: Array<{ id: string; name: string }>;
  /** Партнёр: селект организации; null — фильтр не показывается. */
  organizations?: Array<{ id: string; name: string }> | null;
  current: { direction?: string; status?: string; search?: string; organization?: string };
  /** Скрытые параметры, которые надо сохранить при submit (например ?org= активной организации). */
  hidden?: Record<string, string>;
}) {
  return (
    <form method='get' className='flex flex-wrap gap-2 items-center'>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type='hidden' name={name} value={value} />
      ))}
      {organizations && (
        <select name='organization' defaultValue={current.organization ?? ''} className={selectCls} aria-label='Организация'>
          <option value=''>Все организации</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <select name='direction' defaultValue={current.direction ?? ''} className={selectCls} aria-label='Направление'>
        <option value=''>Все направления</option>
        {directions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <select name='status' defaultValue={current.status ?? ''} className={selectCls} aria-label='Статус'>
        {CERTIFICATE_STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <input
        type='search'
        name='search'
        defaultValue={current.search ?? ''}
        placeholder='Поиск по ФИО…'
        className='border border-gray-200 rounded-lg px-3 py-2 text-sm w-full md:w-64 focus:outline-none focus:border-[#F97316]'
      />
      <button
        type='submit'
        className='text-sm font-medium text-white bg-[#F97316] hover:bg-[#EA580C] rounded-lg px-4 py-2'
      >
        Показать
      </button>
    </form>
  );
}
