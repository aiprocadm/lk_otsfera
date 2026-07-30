'use client';

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui';

/**
 * Этап 7 (ФТ-8.3) — фильтры руководителя/админа: по менеджеру и «Без
 * ответственного». Состояние в URL (assignee / unassigned), фильтрует сервис.
 */
export function IntakeFilters({
  managers,
  assigneeId,
  onlyUnassigned
}: {
  managers: { id: string; name: string }[];
  assigneeId: string | null;
  onlyUnassigned: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // `assigneeId` в патче обязателен: оба обработчика ниже всегда передают его
  // явно (список — выбранное значение, чекбокс — null). Прежняя развилка
  // «не передали → взять текущее» была недостижима (Ф2 программы покрытия).
  function apply(patch: { assigneeId: string | null; onlyUnassigned?: boolean }): void {
    const q = new URLSearchParams(searchParams.toString());
    q.delete('skip'); // смена фильтра сбрасывает пагинацию
    const nextAssignee = patch.assigneeId;
    const nextUnassigned = patch.onlyUnassigned !== undefined ? patch.onlyUnassigned : onlyUnassigned;
    if (nextAssignee) q.set('assignee', nextAssignee);
    else q.delete('assignee');
    if (nextUnassigned) q.set('unassigned', '1');
    else q.delete('unassigned');
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        aria-label="Ответственный"
        value={assigneeId ?? ''}
        disabled={onlyUnassigned}
        onChange={(e) => apply({ assigneeId: e.target.value || null })}
        className="w-56"
      >
        <option value="">Все ответственные</option>
        {managers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          className="h-4 w-4 rounded"
          checked={onlyUnassigned}
          onChange={(e) => apply({ onlyUnassigned: e.target.checked, assigneeId: null })}
        />
        Без ответственного
      </label>
    </div>
  );
}
