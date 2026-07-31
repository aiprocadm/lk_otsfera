import React from 'react';
import Link from 'next/link';
import type { OrgPaymentRow } from '@/lib/services/organization/finance';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { paymentMethodRu } from '@/lib/i18n/labels';
import { fmtMoney, fmtDate } from '@/lib/format';

export function OrgFinancePayments({
  payments,
  orgId,
}: {
  payments: OrgPaymentRow[];
  orgId: string;
}) {
  if (payments.length === 0) {
    return <EmptyState icon="💸" message="Платежей пока нет." />;
  }
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider">
        История платежей
      </h2>
      <TableShell overflow="x-auto">
        <THead>
          <Th>Дата</Th>
          <Th>Заказ</Th>
          <Th>Способ</Th>
          <Th>Назначение</Th>
          <Th>№ поручения</Th>
          <Th className="text-right">НДС</Th>
          <Th className="text-right">Сумма</Th>
          <Th>Внёс</Th>
        </THead>
        <tbody>
          {payments.map((p) => (
            <Tr key={p.id}>
              <Td className="text-gray-500">{fmtDate(p.paidAt)}</Td>
              <Td>
                {p.orderId ? (
                  <Link
                    href={`/organization/orders/${p.orderId}?org=${orgId}`}
                    className="text-[#F97316] hover:underline"
                  >
                    {p.orderNumber ?? '—'}
                  </Link>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </Td>
              <Td className="text-gray-600">
                {p.isRefund ? (
                  <span className="text-red-600">Возврат</span>
                ) : (
                  paymentMethodRu(p.method)
                )}
              </Td>
              <Td className="text-gray-600 max-w-xs truncate">{p.purpose ?? '—'}</Td>
              <Td className="text-gray-600">{p.paymentOrderNumber ?? '—'}</Td>
              <Td className="text-right text-gray-600">
                {p.vatAmount != null ? fmtMoney(p.vatAmount) : '—'}
              </Td>
              <Td
                className={`text-right font-medium ${p.isRefund ? 'text-red-600' : 'text-gray-800'}`}
              >
                {p.isRefund ? '−' : ''}
                {fmtMoney(p.amount)}
              </Td>
              <Td className="text-gray-500 text-sm">{p.enteredByName ?? '—'}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </div>
  );
}
