import Link from 'next/link';
import type { ExecutionStatus, FinancialStatus } from '@prisma/client';
import type { ManagerOrderRow } from '@/lib/services/manager/orders';
import { DealStatusBadge } from '@/components/partner/deal-status-badge';
import type { Stage } from '@/lib/orders/humanStage';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';

// Per-dimension labels + tones. Combined-dimension `orderStage` from
// `@/lib/orders/humanStage` collapses both axes into a single badge — for the
// manager table we want two columns so we render two narrower badges.

const EXECUTION_STAGE: Record<ExecutionStatus, Stage> = {
  pending: { label: 'Ожидает старта', tone: 'neutral' },
  in_progress: { label: 'В работе', tone: 'neutral' },
  on_hold: { label: 'На паузе', tone: 'warning' },
  completed: { label: 'Завершён', tone: 'success' },
  cancelled: { label: 'Отменён', tone: 'danger' }
};

const FINANCIAL_STAGE: Record<FinancialStatus, Stage> = {
  not_billed: { label: 'Счёт не выставлен', tone: 'neutral' },
  billed: { label: 'Счёт выставлен', tone: 'neutral' },
  partially_paid: { label: 'Частично оплачен', tone: 'warning' },
  paid: { label: 'Оплачен', tone: 'success' },
  refunded: { label: 'Возврат', tone: 'danger' }
};

function fmtMoney(s: string | number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

type SearchParams = {
  q?: string;
  executionStatus?: string;
  financialStatus?: string;
  organizationId?: string;
  cursor?: string;
};

type Props = {
  rows: ManagerOrderRow[];
  nextCursor: string | null;
  searchParams: SearchParams;
};

function buildNextHref(searchParams: SearchParams, cursor: string): string {
  const params = new URLSearchParams();
  if (searchParams.q) params.set('q', searchParams.q);
  if (searchParams.executionStatus) params.set('executionStatus', searchParams.executionStatus);
  if (searchParams.financialStatus) params.set('financialStatus', searchParams.financialStatus);
  if (searchParams.organizationId) params.set('organizationId', searchParams.organizationId);
  params.set('cursor', cursor);
  return `/manager/orders?${params.toString()}`;
}

export function ManagerOrdersTable({ rows, nextCursor, searchParams }: Props) {
  if (rows.length === 0) {
    return <EmptyState icon='📋' message='По выбранным фильтрам заказов нет' />;
  }

  return (
    <div className='space-y-3'>
      <TableShell className='hidden md:block'>
        <THead>
          <Th>№</Th>
          <Th>Название</Th>
          <Th>Организация</Th>
          <Th className='text-right'>Сумма</Th>
          <Th className='text-right'>Оплачено</Th>
          <Th>Исполнение</Th>
          <Th>Финансы</Th>
          <Th>Менеджер</Th>
        </THead>
        <tbody>
          {rows.map((o) => (
            <Tr key={o.id}>
              <Td className='text-gray-500'>{o.orderNumber ?? '—'}</Td>
              <Td>
                <Link
                  href={`/manager/orders/${o.id}`}
                  className='font-medium text-[#111111] hover:text-[#F97316]'
                >
                  {o.title}
                </Link>
              </Td>
              <Td className='text-gray-600'>{o.organization.name}</Td>
              <Td className='text-right text-gray-700'>
                {fmtMoney(o.totalAmount.toString())}
              </Td>
              <Td className='text-right text-gray-700'>
                {fmtMoney(o.paidAmount.toString())}
              </Td>
              <Td>
                <DealStatusBadge stage={EXECUTION_STAGE[o.executionStatus]} />
              </Td>
              <Td>
                <DealStatusBadge stage={FINANCIAL_STAGE[o.financialStatus]} />
              </Td>
              <Td className='text-gray-600'>{o.manager?.name ?? '—'}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {nextCursor && (
        <div className='flex justify-center'>
          <Link
            href={buildNextHref(searchParams, nextCursor)}
            className='px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:border-[#F97316] hover:text-[#F97316]'
          >
            Дальше →
          </Link>
        </div>
      )}
    </div>
  );
}
