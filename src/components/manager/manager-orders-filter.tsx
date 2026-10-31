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
  { value: 'refunded', label: 'Возврат' },
];

type Props = {
  initial: {
    search?: string;
    statusId?: string;
    financialStatus?: string;
    organizationId?: string;
    companyId?: string;
    unassigned?: string;
    /** Этап 4 ТЗ 13.10.2026 (`Р-4-3`): поиск внутри фокуса его не сбрасывает. */
    focus?: string | undefined;
  };
  basePath?: string;
  /** §10 ТЗ v0.5: рабочие статусы из справочника для выпадающего списка. */
  statuses?: { id: string; label: string }[];
  /**
   * `У-112`: выбор компании-продавца. Есть только у администратора — менеджер
   * и руководитель всегда внутри одной компании, и выбирать им нечего.
   * Не передан — селект не рисуется вовсе.
   */
  companies?: Array<{ id: string; name: string }>;
};

/**
 * Этап 5 ТЗ 28.10.2026 (`У-350`, РК 5): выпадающего списка организаций больше
 * нет — в нём нельзя было набрать название, только листать. Организация
 * ищется общей строкой поиска (сервис списка сверяет и название организации);
 * параметр `organizationId` в адресе сервис по-прежнему понимает.
 */
export function ManagerOrdersFilter({
  initial,
  statuses = [],
  basePath = '/manager',
  companies,
}: Props) {
  const unassigned = initial.unassigned === '1';
  const hasFilter =
    !!initial.search ||
    !!initial.statusId ||
    !!initial.financialStatus ||
    !!initial.organizationId ||
    !!initial.companyId ||
    unassigned;

  return (
    <form
      method="get"
      action={`${basePath}/orders`}
      // `md:flex-wrap`: полей до шести (у админа ещё «Компания») — в одну строку
      // на окне 1280 они не помещались, и «Найти» уезжала за правый край.
      className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col md:flex-row md:flex-wrap md:items-center gap-2"
    >
      {initial.focus && <input type="hidden" name="focus" value={initial.focus} />}
      <input
        type="search"
        name="search"
        defaultValue={initial.search ?? ''}
        placeholder="Поиск по названию, номеру заказа и организации…"
        aria-label="Поиск по названию, номеру заказа и организации"
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 md:min-w-64 focus:outline-none focus:border-[#F97316]"
      />

      <select
        name="statusId"
        defaultValue={initial.statusId ?? ''}
        aria-label="Статус заявки"
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
      >
        <option value="">Любой статус</option>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        name="financialStatus"
        defaultValue={initial.financialStatus ?? ''}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
      >
        {FINANCIAL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {companies && (
        <select
          name="companyId"
          defaultValue={initial.companyId ?? ''}
          aria-label="Компания"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
        >
          <option value="">Все компании</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}

      <label className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 cursor-pointer whitespace-nowrap">
        <input
          type="checkbox"
          name="unassigned"
          value="1"
          defaultChecked={unassigned}
          className="accent-[#F97316]"
        />
        Без менеджера
      </label>

      <button
        type="submit"
        className="px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]"
      >
        Найти
      </button>

      {hasFilter && (
        <Link
          href={`${basePath}/orders`}
          className="px-3 py-2 text-sm text-gray-600 hover:text-[#F97316]"
        >
          Сбросить
        </Link>
      )}
    </form>
  );
}
