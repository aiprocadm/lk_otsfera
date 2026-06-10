import Link from 'next/link';
import type { OrgOrderRow } from '@/lib/services/organization/orders';
import { DealStatusBadge } from '@/components/partner/deal-status-badge';

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
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3'>
          <span className='text-2xl'>📋</span>
        </div>
        <p className='text-gray-500 text-sm'>По выбранным фильтрам заказов нет</p>
      </div>
    );
  }

  return (
    <div className='hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-gray-100 bg-gray-50 text-left'>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>№</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>Заказ</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>Менеджер</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>Статус</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600 text-right'>Сумма</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600 text-right'>К оплате</th>
            <th scope='col' className='px-4 py-2.5 font-medium text-gray-600'>Срок</th>
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
                  href={orderDetailHref(o.id, orgParam)}
                  className='font-medium text-[#111111] hover:text-[#F97316]'
                >
                  {o.title}
                </Link>
              </td>
              <td className='px-4 py-2.5 text-gray-600'>{o.managerName ?? '—'}</td>
              <td className='px-4 py-2.5'>
                <DealStatusBadge stage={o.stage} />
              </td>
              <td className='px-4 py-2.5 text-right text-gray-700'>{fmtMoney(o.totalAmount)}</td>
              <td
                className={`px-4 py-2.5 text-right ${
                  Number(o.debt) > 0 ? 'text-red-700 font-medium' : 'text-gray-500'
                }`}
              >
                {fmtMoney(o.debt)}
              </td>
              <td className='px-4 py-2.5 text-gray-500'>{fmtDate(o.deadline)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
