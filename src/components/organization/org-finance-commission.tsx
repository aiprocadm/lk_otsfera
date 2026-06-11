import React from 'react';
import type { OrgIntermediaryCommission } from '@/lib/services/organization/finance';
import { THead, Th, Tr, Td } from '@/components/ui';

function fmtMoney(val: string): string {
  const n = Number(val);
  return (isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)) + ' ₽';
}

export function OrgFinanceCommission({ data }: { data: OrgIntermediaryCommission }) {
  const ratePct = (Number(data.effectiveRate) * 100).toFixed(2);
  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h2 className='text-sm font-medium text-gray-500 uppercase tracking-wider'>Комиссия посредника</h2>
          <p className='text-xs text-gray-400 mt-0.5'>Оценка по текущей ставке · видно только руководству</p>
        </div>
        <div className='text-right'>
          <div className='text-2xl font-bold text-[#111111]'>{fmtMoney(data.totalCommission)}</div>
          <div className='text-xs text-gray-500'>ставка {ratePct}%</div>
        </div>
      </div>
      {data.perOrder.length > 0 && (
        <details className='text-sm'>
          <summary className='cursor-pointer text-gray-500 hover:text-gray-700 text-xs'>По заказам</summary>
          <table className='w-full mt-2'>
            <THead>
              <Th className='px-3 py-1.5 text-gray-500'>Заказ</Th>
              <Th className='px-3 py-1.5 text-gray-500 text-right'>База</Th>
              <Th className='px-3 py-1.5 text-gray-500 text-right'>Комиссия</Th>
            </THead>
            <tbody>
              {data.perOrder.map((o) => (
                <Tr key={o.orderId} hover={false}>
                  <Td className='px-3 py-1.5 text-gray-700'>{o.orderNumber ?? '—'}</Td>
                  <Td className='px-3 py-1.5 text-right text-gray-500'>{fmtMoney(o.baseAmount)}</Td>
                  <Td className='px-3 py-1.5 text-right font-medium text-gray-700'>{fmtMoney(o.commissionAmount)}</Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
