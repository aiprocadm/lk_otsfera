'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Select } from '@/components/ui';
import type { TaskBoard as TaskBoardData, TaskCard } from '@/lib/services/tasks/board';
import { TaskDialog, type TaskFormOptions } from '@/components/tasks/task-dialog';

/**
 * Этап 7 (ФТ-7.4) — вид «список»: те же данные, что и доска (плоско), сортировка
 * по сроку/приоритету, клик по строке открывает тот же TaskDialog.
 */

const PRIORITY_LABEL: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
const PRIORITY_TONE: Record<string, 'neutral' | 'warning' | 'danger'> = { low: 'neutral', medium: 'warning', high: 'danger' };
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export type TaskSortKey = 'due' | 'priority';

type Row = TaskCard & { columnName: string };

/** Чистая сортировка (экспорт для тестов): null-срок/приоритет — в конец. */
export function sortTaskRows(rows: Row[], sort: TaskSortKey): Row[] {
  const byDue = (a: Row, b: Row): number => {
    const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
    return ad - bd;
  };
  const byPriority = (a: Row, b: Row): number =>
    (PRIORITY_RANK[a.priority ?? ''] ?? 3) - (PRIORITY_RANK[b.priority ?? ''] ?? 3);
  return [...rows].sort((a, b) => (sort === 'due' ? byDue(a, b) || byPriority(a, b) : byPriority(a, b) || byDue(a, b)));
}

function isOverdue(card: TaskCard): boolean {
  return !!card.dueDate && !card.completedAt && new Date(card.dueDate).getTime() < Date.now();
}

export function TaskList({ board, options }: { board: TaskBoardData; options: TaskFormOptions }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sort, setSort] = useState<TaskSortKey>('due');
  const [editing, setEditing] = useState<TaskCard | null>(null);

  const rows = useMemo(() => {
    const flat: Row[] = board.board.flatMap((col) => col.cards.map((c) => ({ ...c, columnName: col.column.name })));
    return sortTaskRows(flat, sort);
  }, [board, sort]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Select aria-label="Сортировка" value={sort} onChange={(e) => setSort(e.target.value as TaskSortKey)} className="w-56">
          <option value="due">Сначала ближайший срок</option>
          <option value="priority">Сначала важные</option>
        </Select>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Задач нет.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-[#F3F4F6] text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Задача</th>
                <th className="px-4 py-2 font-medium">Колонка</th>
                <th className="px-4 py-2 font-medium">Приоритет</th>
                <th className="px-4 py-2 font-medium">Срок</th>
                <th className="px-4 py-2 font-medium">Исполнители</th>
                <th className="px-4 py-2 font-medium">Связи</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id} className="cursor-pointer hover:bg-[#FFF7ED]" onClick={() => setEditing(row)}>
                  <td className="px-4 py-2.5 font-medium text-[#111111]">{row.title}</td>
                  <td className="px-4 py-2.5 text-gray-600">{row.columnName}</td>
                  <td className="px-4 py-2.5">
                    {row.priority ? (
                      <Badge tone={PRIORITY_TONE[row.priority] ?? 'neutral'}>{PRIORITY_LABEL[row.priority]}</Badge>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 ${isOverdue(row) ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                    {row.dueDate ? new Date(row.dueDate).toLocaleDateString('ru-RU') : '—'}
                    {isOverdue(row) && ' (просрочена)'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {row.assigneeNames.length > 0 ? row.assigneeNames.join(', ') : 'без исполнителя'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {[
                      row.linkedOrganizationName,
                      row.linkedOrderTitle,
                      row.linkedLeadSubject && `Лид: ${row.linkedLeadSubject}`,
                      row.linkedDealTitle && `Сделка: ${row.linkedDealTitle}`
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TaskDialog
          key={editing.id}
          target={editing}
          columns={board.columns}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}
