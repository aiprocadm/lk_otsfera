import React from 'react';
import Link from 'next/link';
import type { ManagerLeadRow } from '@/lib/services/manager/leads';
import { LeadStatusBadge } from '@/components/partner/lead-status-badge';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { fmtMoney } from '@/lib/format';

type Props = {
  rows: ManagerLeadRow[];
  nextCursor: string | null;
  query: Record<string, string | undefined>;
};

function buildNextHref(query: Record<string, string | undefined>, cursor: string): string {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  if (query.assignedToMe) params.set('assignedToMe', query.assignedToMe);
  params.set('cursor', cursor);
  return `/manager/leads?${params.toString()}`;
}

export function ManagerLeadsTable({ rows, nextCursor, query }: Props) {
  if (rows.length === 0) {
    return <EmptyState icon='📬' message='По выбранным фильтрам заявок нет' />;
  }

  return (
    <div className='space-y-3'>
      <TableShell>
        <THead>
          <Th>Клиент</Th>
          <Th>Тема</Th>
          <Th>Партнёр</Th>
          <Th className='text-right'>Оценка</Th>
          <Th>Статус</Th>
          <Th>Менеджер</Th>
        </THead>
        <tbody>
          {rows.map((l) => (
            <Tr key={l.id}>
              <Td>
                <Link href={`/manager/leads/${l.id}`} className='font-medium text-[#111111] hover:text-[#F97316]'>
                  {l.clientCompanyName}
                </Link>
                {l.clientInn && <div className='text-xs text-gray-500'>ИНН {l.clientInn}</div>}
              </Td>
              <Td className='text-gray-600'>{l.subject}</Td>
              <Td className='text-gray-600'>{l.partnerName}</Td>
              <Td className='text-right text-gray-700'>{l.estimatedAmount ? fmtMoney(l.estimatedAmount) : '—'}</Td>
              <Td><LeadStatusBadge status={l.status} /></Td>
              <Td className='text-gray-600'>{l.assignedManagerName ?? '—'}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {nextCursor && (
        <div className='flex justify-center'>
          <Link
            href={buildNextHref(query, nextCursor)}
            className='px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:border-[#F97316] hover:text-[#F97316]'
          >
            Дальше →
          </Link>
        </div>
      )}
    </div>
  );
}
