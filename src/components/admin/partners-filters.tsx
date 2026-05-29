import React from 'react';
import Link from 'next/link';

type Props = {
  active?: string;
  filter?: string;
  q?: string;
};

export function PartnersFilters({ active, filter, q }: Props) {
  const hasActive = active || filter || q;
  return (
    <form method="get" className="flex flex-wrap items-end gap-2 bg-white border border-gray-200 rounded-xl p-3">
      <label className="flex flex-col text-xs text-gray-500">
        Активность
        <select name="active" defaultValue={active ?? ''} className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm">
          <option value="">Все</option>
          <option value="true">Активные</option>
          <option value="false">Деактивированные</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-500 self-end pb-1.5">
        <input
          type="checkbox"
          name="filter"
          value="norate"
          defaultChecked={filter === 'norate'}
        />
        Без ставки
      </label>
      <label className="flex flex-col text-xs text-gray-500 flex-1 min-w-[200px]">
        Поиск
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Название или slug"
          className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <button type="submit" className="px-3 py-1.5 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C]">
        Применить
      </button>
      {hasActive && (
        <Link href="/admin/partners" className="px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-50">
          Сбросить
        </Link>
      )}
    </form>
  );
}
