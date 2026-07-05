import React from 'react';
import Link from 'next/link';
import type { PortfolioItem } from '@/lib/services/partner/portfolio';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

export function PortfolioTable({ items }: { items: PortfolioItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState icon='🏢' message='Нет организаций по выбранным фильтрам' />
    );
  }

  return (
    <TableShell className='hidden md:block'>
      <THead>
        <Th>Организация</Th>
        <Th>ИНН</Th>
        <Th className='text-right'>Сделок</Th>
        <Th className='text-right'>Долг</Th>
      </THead>
      <tbody>
        {items.map((org) => (
          <Tr key={org.id}>
            <Td>
              <Link href={`/partner/portfolio/${org.id}`} className='font-medium text-[#111111] hover:text-[#F97316]'>
                {org.name}
              </Link>
            </Td>
            <Td className='text-gray-500'>{org.inn ?? '—'}</Td>
            <Td className='text-right'>{org.ordersCount}</Td>
            <Td className={`text-right ${Number(org.debt) > 0 ? 'text-red-700 font-medium' : 'text-gray-500'}`}>
              {fmtMoney(org.debt)}
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
