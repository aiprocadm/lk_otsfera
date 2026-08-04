import React from 'react';
import Link from 'next/link';
import type { AuditEntity } from '@/lib/auth/audit';
import { auditActionLabel, auditEntityLabel } from '@/lib/audit/labels';

type Props = {
  /** Адрес экрана: используется ссылкой «Сбросить» (экран переехал в хаб настроек). */
  basePath: string;
  entities: AuditEntity[];
  actions: string[];
  actors: Array<{ id: string; name: string; email: string }>;
  current: {
    entity?: string;
    action?: string;
    actorUserId?: string;
    from?: string;
    to?: string;
    q?: string;
  };
};

/**
 * Русские подписи для выпадающих списков: значение остаётся машинным (фильтр
 * ходит по нему в базу), человек видит название (ТЗ §6.4.4). Сортировка — по
 * русской подписи, иначе список идёт в порядке английских кодов.
 */
function byLabel(values: string[], label: (v: string) => string): Array<[string, string]> {
  return values
    .map((value) => [value, label(value)] as [string, string])
    .sort((a, b) => a[1].localeCompare(b[1], 'ru'));
}

export function AuditLogFilters({ basePath, entities, actions, actors, current }: Props) {
  const hasActive =
    current.entity ||
    current.action ||
    current.actorUserId ||
    current.from ||
    current.to ||
    current.q;

  const entityOptions = byLabel(entities, auditEntityLabel);
  const actionOptions = byLabel(actions, auditActionLabel);

  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-2 bg-white border border-gray-200 rounded-xl p-3"
    >
      <label className="flex flex-col text-xs text-gray-500">
        Сущность
        <select
          name="entity"
          defaultValue={current.entity ?? ''}
          className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
        >
          <option value="">Все сущности</option>
          {entityOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-gray-500">
        Действие
        <select
          name="action"
          defaultValue={current.action ?? ''}
          className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
        >
          <option value="">Все действия</option>
          {actionOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-gray-500">
        Пользователь
        <select
          name="actorUserId"
          defaultValue={current.actorUserId ?? ''}
          className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
        >
          <option value="">Все пользователи</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.email})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-gray-500">
        С
        <input
          type="date"
          name="from"
          defaultValue={current.from ?? ''}
          className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col text-xs text-gray-500">
        По
        <input
          type="date"
          name="to"
          defaultValue={current.to ?? ''}
          className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col text-xs text-gray-500 flex-1 min-w-[200px]">
        Поиск
        <input
          type="search"
          name="q"
          defaultValue={current.q ?? ''}
          placeholder="Поиск по метаданным"
          className="mt-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        className="px-3 py-1.5 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C]"
      >
        Применить
      </button>
      {hasActive && (
        <Link
          href={basePath}
          className="px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-50"
        >
          Сбросить
        </Link>
      )}
    </form>
  );
}
