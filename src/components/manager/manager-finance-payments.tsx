import React from 'react';
import Link from 'next/link';
import type { OrgPaymentRow } from '@/lib/services/organization/finance';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { paymentMethodRu } from '@/lib/i18n/labels';
import { fmtMoney, fmtDate } from '@/lib/format';

export function ManagerFinancePayments({
  payments,
  basePath = '/manager'
}: {
  payments: OrgPaymentRow[];
  basePath?: string;
}) {
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
                <Link href={`${basePath}/orders/${p.orderId}`} className='text-[#F97316] hover:underline'>
                  {p.orderNumber ?? '—'}
                </Link>
              ) : (
                <span className='text-gray-400'>—</span>
              )}
            </Td>
            <Td className='text-gray-600'>
              {p.isRefund ? <span className='text-red-600'>Возврат</span> : paymentMethodRu(p.method)}
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
