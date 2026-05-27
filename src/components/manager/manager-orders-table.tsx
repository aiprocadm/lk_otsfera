import Link from 'next/link';
import type { ExecutionStatus, FinancialStatus } from '@prisma/client';
import type { ManagerOrderRow } from '@/lib/services/manager/orders';
import { DealStatusBadge } from '@/components/partner/deal-status-badge';
import type { Stage } from '@/lib/orders/humanStage';

// Per-dimension labels + tones. Combined-dimension `humanStage` from
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
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>📋</span>
        </div>
        <p className='text-gray-500 text-sm'>По выбранным фильтрам заказов нет</p>
      </div>
    );
  }

  return (
    <div className='space-y-3'>
      <div className='hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b border-gray-100 bg-gray-50 text-left'>
              <th className='px-4 py-2.5 font-medium text-gray-600'>№</th>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Название</th>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Организация</th>
              <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Сумма</th>
              <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Оплачено</th>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Исполнение</th>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Финансы</th>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Менеджер</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, i) => (
              <tr
                key={o.id}
                className={`border-b border-gray-50 hover:bg-[#FFF7ED] ${i === rows.length - 1 ? 'border-b-0' : ''}`}
              >
                <td className='px-4 py-2.5 text-gray-500'>{o.orderNumber ?? '—'}</td>
                <td className='px-4 py-2.5'>
                  <Link
                    href={`/manager/orders/${o.id}`}
                    className='font-medium text-[#111111] hover:text-[#F97316]'
                  >
                    {o.title}
                  </Link>
                </td>
                <td className='px-4 py-2.5 text-gray-600'>{o.organization.name}</td>
                <td className='px-4 py-2.5 text-right text-gray-700'>
                  {fmtMoney(o.totalAmount.toString())}
                </td>
                <td className='px-4 py-2.5 text-right text-gray-700'>
                  {fmtMoney(o.paidAmount.toString())}
                </td>
                <td className='px-4 py-2.5'>
                  <DealStatusBadge stage={EXECUTION_STAGE[o.executionStatus]} />
                </td>
                <td className='px-4 py-2.5'>
                  <DealStatusBadge stage={FINANCIAL_STAGE[o.financialStatus]} />
                </td>
                <td className='px-4 py-2.5 text-gray-600'>{o.manager?.name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
