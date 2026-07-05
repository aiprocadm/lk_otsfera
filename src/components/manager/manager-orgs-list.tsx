import React from 'react';
import Link from 'next/link';
import type { ManagerOrgListRow } from '@/lib/services/manager/organizations';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

/**
 * Presentational table of manager-scoped organizations. Same visual tone as
 * `manager-orders-table` and `partner/portfolio-table`. Counts come from
 * `_count` aggregates, so the row payload is already small (~5 fields).
 */
export function ManagerOrgsList({ orgs }: { orgs: ManagerOrgListRow[] }) {
  if (orgs.length === 0) {
    return <EmptyState icon='🏢' message='Вам пока не назначено ни одной организации.' />;
  }

  return (
    <TableShell>
      <THead>
        <Th>Название</Th>
        <Th className='text-right'>Заказы</Th>
        <Th className='text-right'>Сотрудники</Th>
        <Th className='text-right'></Th>
      </THead>
      <tbody>
        {orgs.map((o) => (
          <Tr key={o.id}>
            <Td>
              <Link
                href={`/manager/organizations/${o.id}`}
                className='font-medium text-[#111111] hover:text-[#F97316]'
              >
                {o.name}
              </Link>
            </Td>
            <Td className='text-right text-gray-700'>{o._count.orders}</Td>
            <Td className='text-right text-gray-700'>{o._count.students}</Td>
            <Td className='text-right'>
              <Link
                href={`/manager/organizations/${o.id}`}
                className='text-[#F97316] hover:underline text-sm'
              >
                →
              </Link>
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
