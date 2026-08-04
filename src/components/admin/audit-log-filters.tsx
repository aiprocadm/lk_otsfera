import React from 'react';
import Link from 'next/link';
import type { AuditEntity } from '@/lib/auth/audit';

type Props = {
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

function groupActions(actions: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const a of actions) {
    // String.prototype.split всегда возвращает минимум один элемент (для строки
    // без разделителя — её саму), поэтому [0] здесь всегда строка.
    const prefix = a.split('_')[0]!;
    (groups[prefix] = groups[prefix] ?? []).push(a);
  }
  return groups;
}

export function AuditLogFilters({ entities, actions, actors, current }: Props) {
  const hasActive =
    current.entity ||
    current.action ||
    current.actorUserId ||
    current.from ||
    current.to ||
    current.q;

  const grouped = groupActions(actions);

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
          {entities.map((e) => (
            <option key={e} value={e}>
              {e}
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
          {Object.entries(grouped).map(([prefix, group]) => (
            <optgroup key={prefix} label={prefix}>
              {group.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </optgroup>
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
          href="/admin/audit"
          className="px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-50"
        >
          Сбросить
        </Link>
      )}
    </form>
  );
}
