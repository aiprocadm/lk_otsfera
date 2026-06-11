import React from 'react';
import Link from 'next/link';
import type { OrgPaymentRow } from '@/lib/services/organization/finance';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

function fmtMoney(val: string): string {
  const n = Number(val);
  return (isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)) + ' ₽';
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
}

export function ManagerFinancePayments({ payments }: { payments: OrgPaymentRow[] }) {
  if (payments.length === 0) {
    return <EmptyState message='Платежей пока нет.' className='p-8' />;
  }
  return (
    <TableShell overflow='x-auto'>
      <THead>
        <Th>Дата</Th>
        <Th>Заказ</Th>
        <Th>Способ</Th>
        <Th className='text-right'>Сумма</Th>
      </THead>
      <tbody>
        {payments.map((p) => (
          <Tr key={p.id}>
            <Td className='text-gray-500'>{fmtDate(p.paidAt)}</Td>
            <Td>
              {p.orderId ? (
                <Link href={`/manager/orders/${p.orderId}`} className='text-[#F97316] hover:underline'>
                  {p.orderNumber ?? '—'}
                </Link>
              ) : (
                <span className='text-gray-400'>—</span>
              )}
            </Td>
            <Td className='text-gray-600'>
              {p.isRefund ? <span className='text-red-600'>Возврат</span> : (p.method ?? '—')}
            </Td>
            <Td className={`text-right font-medium ${p.isRefund ? 'text-red-600' : 'text-gray-800'}`}>
              {p.isRefund ? '−' : ''}
              {fmtMoney(p.amount)}
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
