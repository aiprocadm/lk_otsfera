import React from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import type { ReceivablesResult } from '@/lib/services/leader/receivables';

/**
 * «Дебиторка» (`У-243`, этап 7): кто и сколько должен, как давно и к кому идти.
 *
 * Таблица на широком экране превращается в карточки на телефоне (`У-18`).
 */
function money(v: string): string {
  return `${Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
}

function daysWord(days: number | null): string {
  if (days === null) return '—';
  return `${days} дн.`;
}

export function ReceivablesPanel({
  data,
  basePath,
  query,
}: {
  data: ReceivablesResult;
  /** Адрес вкладки — для ссылок фильтра. */
  basePath: string;
  query?: Record<string, string> | undefined;
}) {
  const filters = [0, 30, 60, 90];

  if (data.rows.length === 0) {
    return (
      <div className="space-y-3" data-testid="receivables-panel">
        <Filters basePath={basePath} query={query} active={data.olderThanDays} options={filters} />
        <EmptyState
          icon="💰"
          title={data.olderThanDays > 0 ? 'Долгов старше срока нет' : 'Долгов нет'}
          message={
            data.olderThanDays > 0
              ? 'Попробуйте снять фильтр по сроку — возможно, долги есть, но моложе.'
              : 'Все выставленные счета оплачены. Как только появится неоплаченный заказ, он будет здесь.'
          }
          className="p-6"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="receivables-panel">
      <Filters basePath={basePath} query={query} active={data.olderThanDays} options={filters} />

      <p className="text-sm text-gray-700">
        Всего долг: <span className="font-medium text-[#111111]">{money(data.totalDebt)}</span>
      </p>

      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
              <th className="py-2">Организация</th>
              <th className="py-2">Выставлено</th>
              <th className="py-2">Оплачено</th>
              <th className="py-2">Долг</th>
              <th className="py-2">Ждут</th>
              <th className="py-2">Ответственный</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.organizationId} className="border-b border-gray-100">
                <td className="py-2">
                  <Link
                    href={`/manager/organizations/${r.organizationId}`}
                    className="text-[#F97316] hover:underline"
                  >
                    {r.organizationName}
                  </Link>
                </td>
                <td className="py-2">{money(r.billed)}</td>
                <td className="py-2">{money(r.paid)}</td>
                <td className="py-2 font-medium text-red-700">{money(r.debt)}</td>
                <td className="py-2">{daysWord(r.oldestDays)}</td>
                <td className="py-2">{r.managerName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {data.rows.map((r) => (
          <li key={r.organizationId} className="rounded-xl border border-gray-200 bg-white p-3">
            <Link
              href={`/manager/organizations/${r.organizationId}`}
              className="text-sm font-medium text-[#F97316]"
            >
              {r.organizationName}
            </Link>
            <p className="mt-1 text-sm text-red-700">Долг: {money(r.debt)}</p>
            <p className="text-xs text-gray-500">
              Выставлено {money(r.billed)} · оплачено {money(r.paid)} · ждут{' '}
              {daysWord(r.oldestDays)}
            </p>
            <p className="text-xs text-gray-500">Ответственный: {r.managerName ?? '—'}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Filters({
  basePath,
  query,
  active,
  options,
}: {
  basePath: string;
  query?: Record<string, string> | undefined;
  active: number;
  options: number[];
}) {
  return (
    <div className="flex flex-wrap gap-2 text-sm" data-testid="receivables-filters">
      {options.map((days) => {
        const params = new URLSearchParams({ ...(query ?? {}), tab: 'receivables' });
        if (days > 0) params.set('older', String(days));
        const isActive = active === days;
        return (
          <Link
            key={days}
            href={`${basePath}?${params.toString()}`}
            className={
              isActive
                ? 'rounded-full bg-[#F97316] px-3 py-1 text-white'
                : 'rounded-full bg-[#F3F4F6] px-3 py-1 text-gray-700 hover:bg-gray-200'
            }
          >
            {days === 0 ? 'Все долги' : `Старше ${days} дней`}
          </Link>
        );
      })}
    </div>
  );
}
