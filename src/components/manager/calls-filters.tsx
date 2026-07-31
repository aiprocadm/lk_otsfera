import React from 'react';
import Link from 'next/link';

/**
 * Фильтры звонков — link-based query-param навигация (без клиентского JS),
 * тот же паттерн, что `inbox-filters.tsx`. Сервер-компонент.
 */

const DIRECTIONS: { value: string; label: string }[] = [
  { value: 'inbound', label: 'Входящие' },
  { value: 'outbound', label: 'Исходящие' },
];

function buildHref(direction: string | undefined, orgId: string | undefined): string {
  const params = new URLSearchParams();
  if (direction) params.set('direction', direction);
  if (orgId) params.set('orgId', orgId);
  const qs = params.toString();
  return qs ? `/manager/calls?${qs}` : '/manager/calls';
}

export function CallsFiltersBar({
  direction,
  orgId,
  children,
}: {
  direction?: string;
  orgId?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:gap-8">
      <div>
        <p className="mb-1.5 text-xs font-medium text-gray-500">Направление</p>
        <div className="flex flex-wrap gap-1.5">
          <Link
            href={buildHref(undefined, orgId)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !direction
                ? 'bg-[#F97316] text-white'
                : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Все
          </Link>
          {DIRECTIONS.map((opt) => (
            <Link
              key={opt.value}
              href={buildHref(opt.value, orgId)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                direction === opt.value
                  ? 'bg-[#F97316] text-white'
                  : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}
