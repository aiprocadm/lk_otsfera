import React from 'react';
import Link from 'next/link';
import type { OrgOrderRow } from '@/lib/services/organization/orders';
import { DealStatusBadge } from '@/components/partner/deal-status-badge';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit'
  }).format(d);
}

function orderDetailHref(id: string, orgParam: string | null): string {
  return orgParam
    ? `/organization/orders/${id}?org=${encodeURIComponent(orgParam)}`
    : `/organization/orders/${id}`;
}

export function OrgOrdersTable({
  rows,
  orgParam
}: {
  rows: OrgOrderRow[];
  orgParam: string | null;
}) {
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
        <Th>Менеджер</Th>
        <Th>Статус</Th>
        <Th className='text-right'>Сумма</Th>
        <Th className='text-right'>К оплате</Th>
        <Th>Срок</Th>
      </THead>
      <tbody>
        {rows.map((o) => (
          <Tr key={o.id}>
            <Td className='text-gray-500'>{o.orderNumber ?? '—'}</Td>
            <Td>
              <Link
                href={orderDetailHref(o.id, orgParam)}
                className='font-medium text-[#111111] hover:text-[#F97316]'
              >
                {o.title}
              </Link>
            </Td>
            <Td className='text-gray-600'>{o.managerName ?? '—'}</Td>
            <Td>
              <DealStatusBadge stage={o.stage} />
            </Td>
            <Td className='text-right text-gray-700'>{fmtMoney(o.totalAmount)}</Td>
            <Td
              className={`text-right ${
                Number(o.debt) > 0 ? 'text-red-700 font-medium' : 'text-gray-500'
              }`}
            >
              {fmtMoney(o.debt)}
            </Td>
            <Td className='text-gray-500'>{fmtDate(o.deadline)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function OrgOrdersCardList({
  rows,
  orgParam
}: {
  rows: OrgOrderRow[];
  orgParam: string | null;
}) {
  if (rows.length === 0) return null;
  return (
    <div className='md:hidden space-y-2'>
      {rows.map((o) => (
        <Link
          key={o.id}
          href={orderDetailHref(o.id, orgParam)}
          className='block bg-white border border-gray-200 rounded-xl p-3 hover:border-[#F97316]'
        >
          <div className='flex items-start justify-between gap-2'>
            <div className='min-w-0 flex-1'>
              <div className='font-medium text-sm text-[#111111] truncate'>{o.title}</div>
              <div className='text-xs text-gray-500 mt-0.5'>
                №{o.orderNumber ?? '—'} · {o.managerName ?? 'без менеджера'}
              </div>
            </div>
            <DealStatusBadge stage={o.stage} />
          </div>
          <div className='mt-2 flex items-center justify-between text-xs'>
            <span className='text-gray-500'>
              {fmtMoney(o.totalAmount)} · долг {fmtMoney(o.debt)}
            </span>
            <span className='text-gray-400'>{fmtDate(o.deadline)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
