import React from 'react';
import Link from 'next/link';
import {
  deactivatePartnerFormAction,
  reactivatePartnerFormAction
} from '@/server-actions/admin/partners';
import type { PartnerRow } from '@/lib/services/admin/partners';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

const rub = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });

function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'percent',
    maximumFractionDigits: 2
  }).format(rate);
}

export function PartnersTable({ rows }: { rows: PartnerRow[] }) {
  if (rows.length === 0) {
    return <EmptyState message='Партнёров не найдено' className='p-8' />;
  }
  return (
    <TableShell>
      <THead>
        <Th>Название</Th>
        <Th>Slug</Th>
        <Th>Ставка</Th>
        <Th>Активных орг</Th>
        <Th>Сумма выплат YTD</Th>
        <Th>Активен</Th>
        <Th className='text-right'>Действия</Th>
      </THead>
      <tbody>
        {rows.map((p) => (
          <Tr key={p.id}>
            <Td className='font-medium text-[#111111]'>{p.name}</Td>
            <Td className='font-mono text-xs text-gray-600'>{p.slug}</Td>
            <Td className='text-gray-600'>{formatRate(p.commissionRate)}</Td>
            <Td className='text-gray-600'>{p.activeOrgCount}</Td>
            <Td className='text-gray-600'>{rub.format(Number(p.paidYTD))}</Td>
            <Td>
              {p.isActive ? (
                <span className='text-green-600 text-xs'>●</span>
              ) : (
                <span className='text-gray-300 text-xs'>●</span>
              )}
            </Td>
            <Td className='text-right'>
              <div className='flex items-center justify-end gap-2'>
                <Link href={`/admin/partners/${p.id}`} className='text-[#F97316] text-xs hover:underline'>
                  Редактировать
                </Link>
                {p.isActive ? (
                  <form action={deactivatePartnerFormAction}>
                    <input type='hidden' name='id' value={p.id} />
                    <button type='submit' className='text-gray-500 text-xs hover:text-red-600'>
                      Деактивировать
                    </button>
                  </form>
                ) : (
                  <form action={reactivatePartnerFormAction}>
                    <input type='hidden' name='id' value={p.id} />
                    <button type='submit' className='text-gray-500 text-xs hover:text-green-600'>
                      Восстановить
                    </button>
                  </form>
                )}
              </div>
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
