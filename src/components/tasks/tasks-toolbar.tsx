'use client';

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui';

import type { TasksToolbarState } from '@/lib/tasks/filters';

/**
 * Этап 7 (ФТ-7.3/7.4) — фильтры задач и переключатель «доска/список».
 * Состояние живёт в URL-searchParams (scope/assignee/overdue/view): страница
 * серверная, фильтрация — в сервисе; кнопки просто меняют query.
 * Парсер состояния — `@/lib/tasks/filters` (серверная страница вызывает его сама).
 */

function segmented(active: boolean): string {
  return `px-3 py-1.5 text-sm rounded-lg border transition-colors ${
    active
      ? 'bg-[#F97316] border-[#F97316] text-white'
      : 'bg-white border-gray-200 text-[#111111] hover:border-[#F97316]'
  }`;
}

export function TasksToolbar({
  state,
  assigneeOptions,
}: {
  state: TasksToolbarState;
  /** Список для фильтра по исполнителю (ФТ-7.3, только руководитель); null — фильтр скрыт. */
  assigneeOptions: { id: string; name: string }[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function apply(patch: Partial<TasksToolbarState>): void {
    const next = { ...state, ...patch };
    const q = new URLSearchParams(searchParams.toString());
    const setOrDelete = (k: string, v: string | null) => (v ? q.set(k, v) : q.delete(k));
    setOrDelete('scope', next.scope === 'mine' ? 'mine' : null);
    setOrDelete('assignee', next.assigneeId);
    setOrDelete('overdue', next.overdue ? '1' : null);
    setOrDelete('view', next.view === 'list' ? 'list' : null);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1" role="group" aria-label="Охват задач">
        <button
          type="button"
          className={segmented(state.scope === 'all')}
          onClick={() => apply({ scope: 'all' })}
        >
          Все
        </button>
        <button
          type="button"
          className={segmented(state.scope === 'mine')}
          onClick={() => apply({ scope: 'mine' })}
        >
          Мои
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          className="h-4 w-4 rounded"
          checked={state.overdue}
          onChange={(e) => apply({ overdue: e.target.checked })}
        />
        Просроченные
      </label>

      {assigneeOptions && (
        <Select
          aria-label="Исполнитель"
          value={state.assigneeId ?? ''}
          onChange={(e) => apply({ assigneeId: e.target.value || null })}
          className="w-52"
        >
          <option value="">Все исполнители</option>
          {assigneeOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      )}

      <div className="ml-auto flex gap-1" role="group" aria-label="Вид">
        <button
          type="button"
          className={segmented(state.view === 'board')}
          onClick={() => apply({ view: 'board' })}
        >
          Доска
        </button>
        <button
          type="button"
          className={segmented(state.view === 'list')}
          onClick={() => apply({ view: 'list' })}
        >
          Список
        </button>
      </div>
    </div>
  );
}
