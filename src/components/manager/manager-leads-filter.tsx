import React from 'react';
import Link from 'next/link';
import { LEAD_STATUS_FILTER_LABELS_RU } from '@/lib/leads/statuses';

// Вкладки строятся из единого источника (@/lib/leads/statuses): список
// статусов больше не дублируется здесь и не может разъехаться с prisma-enum.
const TABS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Все' },
  ...Object.entries(LEAD_STATUS_FILTER_LABELS_RU).map(([value, label]) => ({ value, label })),
];

type Query = {
  status?: string | undefined;
  q?: string | undefined;
  assignedToMe?: string | undefined;
};

function href(basePath: string, q: Query, patch: Partial<Query>): string {
  const merged = { ...q, ...patch };
  const params = new URLSearchParams();
  if (merged.status) params.set('status', merged.status);
  if (merged.q) params.set('q', merged.q);
  if (merged.assignedToMe) params.set('assignedToMe', merged.assignedToMe);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * `basePath` — адрес «Лидов» своего кабинета (`/manager/leads`, `/leader/leads`):
 * фильтры и поиск остаются в разделе, из которого их нажали (`У-349`).
 */
export function ManagerLeadsFilter({ basePath, query }: { basePath: string; query: Query }) {
  const active = query.status ?? '';
  const mine = query.assignedToMe === '1';
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.value || 'all'}
            href={href(
              basePath,
              { q: query.q, assignedToMe: query.assignedToMe },
              { status: t.value }
            )}
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
      {/* `У-13`: поиск шириной 256px + кнопка + ссылка не помещаются в строку
          телефона (424px против 390px) — разрешаем перенос, а поле делаем
          растяжимым вместо жёсткой ширины. */}
      <div className="flex flex-wrap items-center gap-3">
        <form method="get" action={basePath} className="flex w-full gap-2 sm:w-auto">
          {query.status && <input type="hidden" name="status" value={query.status} />}
          {mine && <input type="hidden" name="assignedToMe" value="1" />}
          <input
            type="text"
            name="q"
            defaultValue={query.q ?? ''}
            placeholder="Поиск: клиент, тема, ИНН"
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-full min-w-0 sm:w-64"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:border-[#F97316]"
          >
            Найти
          </button>
        </form>
        <Link
          href={href(
            basePath,
            { status: query.status, q: query.q },
            { assignedToMe: mine ? '' : '1' }
          )}
          className={`px-3 py-1.5 text-sm rounded-lg border ${
            mine
              ? 'bg-[#FFF7ED] text-[#9A3412] border-[#FED7AA]'
              : 'border-gray-200 text-gray-700 hover:border-[#F97316]'
          }`}
        >
          {/* `У-288`: в разделе «Лиды» фильтр называется по объекту раздела. */}
          {mine ? '✓ Мои лиды' : 'Мои лиды'}
        </Link>
      </div>
    </div>
  );
}
