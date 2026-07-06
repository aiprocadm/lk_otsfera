import React from 'react';
import Link from 'next/link';
import type { DealRow } from '@/lib/services/partner/deals';
import { DealStatusBadge } from './deal-status-badge';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
}

export function DealsTable({ rows }: { rows: DealRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState icon='📋' message='По выбранным фильтрам заказов нет' />
    );
  }

  return (
    <TableShell className='hidden md:block'>
      <THead>
        <Th>№</Th>
        <Th>Заказ</Th>
        <Th>Организация</Th>
        <Th>Статус</Th>
        <Th className='text-right'>Сумма</Th>
        <Th className='text-right'>Долг</Th>
        <Th>Срок</Th>
      </THead>
      <tbody>
        {rows.map((d) => (
          <Tr key={d.id}>
            <Td className='text-gray-500'>{d.orderNumber ?? '—'}</Td>
            <Td>
              <Link
                href={`/partner/deals/${d.id}`}
                className='font-medium text-[#111111] hover:text-[#F97316]'
              >
                {d.title}
              </Link>
            </Td>
            <Td>
              {d.organizationId ? (
                <Link
                  href={`/partner/portfolio/${d.organizationId}`}
                  className='text-gray-600 hover:text-[#F97316]'
                >
                  {d.organizationName}
                </Link>
              ) : (
                <span className='text-gray-500'>{d.organizationName}</span>
              )}
            </Td>
            <Td>
              <DealStatusBadge stage={d.stage} />
            </Td>
            <Td className='text-right text-gray-700'>{fmtMoney(d.totalAmount)}</Td>
            <Td
              className={`text-right ${
                Number(d.debt) > 0 ? 'text-red-700 font-medium' : 'text-gray-500'
              }`}
            >
              {fmtMoney(d.debt)}
            </Td>
            <Td className='text-gray-500'>{fmtDate(d.deadline)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
