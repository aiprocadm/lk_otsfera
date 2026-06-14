import React from 'react';
import type { LeaderManagerRow } from '@/lib/services/leader/dashboard';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { fmtMoney } from '@/lib/format';

/**
 * Presentational per-manager breakdown for the leader «Сводка по команде».
 * Company-wide always (one row per company manager). Money values arrive as
 * 2-decimal strings (service contract §3) and render via `fmtMoney`; an overdue
 * count > 0 is highlighted red.
 */
export function LeaderManagersTable({ rows }: { rows: LeaderManagerRow[] }) {
  if (rows.length === 0) {
    return <EmptyState icon='👥' message='В компании пока нет менеджеров.' />;
  }

  return (
    <TableShell>
      <THead>
        <Th>Менеджер</Th>
        <Th>Активных заказов</Th>
        <Th>Сумма в работе</Th>
        <Th>Оплачено</Th>
        <Th>Просрочено</Th>
      </THead>
      <tbody>
        {rows.map((m) => (
          <Tr key={m.managerId}>
            <Td>
              <div className='font-medium text-[#111111]'>{m.name}</div>
              <div className='text-xs text-gray-500'>{m.email}</div>
            </Td>
            <Td className='text-gray-700'>{m.activeOrders}</Td>
            <Td className='text-gray-700'>{fmtMoney(m.totalAmount)}</Td>
            <Td className='text-gray-700'>{fmtMoney(m.paidAmount)}</Td>
            <Td className={m.overdue > 0 ? 'font-medium text-red-700' : 'text-gray-700'}>
              {m.overdue}
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
