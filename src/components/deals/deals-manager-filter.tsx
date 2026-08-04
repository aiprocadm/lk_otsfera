'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui';

/**
 * Этап 6 (PR-1) — фильтр доски сделок руководителя по ответственному
 * менеджеру: клиентский `Select` с `router.push` (клон calls-org-filter).
 */
export function DealsManagerFilter({
  managers,
  managerId,
}: {
  managers: { id: string; name: string }[];
  managerId?: string | undefined;
}) {
  const router = useRouter();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams();
    if (event.target.value) params.set('manager', event.target.value);
    const qs = params.toString();
    router.push(qs ? `/leader/deals?${qs}` : '/leader/deals');
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-gray-500">Менеджер</p>
      <Select
        aria-label="Менеджер"
        value={managerId ?? ''}
        onChange={handleChange}
        className="w-full sm:w-64"
      >
        <option value="">Все менеджеры</option>
        {managers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
