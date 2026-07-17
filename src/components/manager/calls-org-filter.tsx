'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui';
import type { ManagerOrgListRow } from '@/lib/services/manager/organizations';

/**
 * Фильтр звонков по организации — клиентский `Select` с `router.push`.
 *
 * Query собирается заново при каждом изменении: текущий `direction`
 * сохраняется, `page` намеренно НЕ переносится — смена организации
 * сбрасывает пагинацию на первую страницу.
 */
export function CallsOrgFilter({
  orgs,
  orgId,
  direction
}: {
  orgs: Pick<ManagerOrgListRow, 'id' | 'name'>[];
  orgId?: string;
  direction?: string;
}) {
  const router = useRouter();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams();
    if (event.target.value) params.set('orgId', event.target.value);
    if (direction) params.set('direction', direction);
    const qs = params.toString();
    router.push(qs ? `/manager/calls?${qs}` : '/manager/calls');
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-gray-500">Организация</p>
      <Select
        aria-label="Организация"
        value={orgId ?? ''}
        onChange={handleChange}
        className="w-full sm:w-64"
      >
        <option value="">Все организации</option>
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
