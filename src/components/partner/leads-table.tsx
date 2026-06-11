import Link from 'next/link';
import type { LeadRow } from '@/lib/services/partner/leads';
import { LeadStatusBadge } from './lead-status-badge';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

function fmtMoney(s: string | null): string {
  if (!s) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
}

export function LeadsTable({ rows }: { rows: LeadRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState icon='✚' message='Заявок пока нет'>
        <Link
          href='/partner/leads/new'
          className='inline-block mt-3 px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C]'
        >
          Создать первую заявку
        </Link>
      </EmptyState>
    );
  }

  return (
    <TableShell className='hidden md:block'>
      <THead>
        <Th>Клиент</Th>
        <Th>Тема</Th>
        <Th>Контакт</Th>
        <Th>Статус</Th>
        <Th className='text-right'>Оценка</Th>
        <Th>Создана</Th>
      </THead>
      <tbody>
        {rows.map((l) => (
          <Tr key={l.id}>
            <Td>
              <Link
                href={`/partner/leads/${l.id}`}
                className='font-medium text-[#111111] hover:text-[#F97316] block'
              >
                {l.clientCompanyName}
              </Link>
              {l.clientInn && <div className='text-xs text-gray-400'>ИНН {l.clientInn}</div>}
            </Td>
            <Td className='text-gray-700 max-w-xs truncate' title={l.subject}>
              {l.subject}
            </Td>
            <Td className='text-gray-500'>{l.clientContactName}</Td>
            <Td>
              <LeadStatusBadge status={l.status} />
            </Td>
            <Td className='text-right text-gray-700'>{fmtMoney(l.estimatedAmount)}</Td>
            <Td className='text-gray-500'>{fmtDate(l.createdAt)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
