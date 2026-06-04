import Link from 'next/link';
import type { OrgPaymentRow } from '@/lib/services/organization/finance';

function fmtMoney(val: string): string {
  const n = Number(val);
  return (isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)) + ' ₽';
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
}

export function OrgFinancePayments({ payments }: { payments: OrgPaymentRow[] }) {
  if (payments.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-12 text-center'>
        <div className='text-4xl mb-3'>💸</div>
        <p className='text-gray-500 text-sm'>Платежей пока нет.</p>
      </div>
    );
  }
  return (
    <div className='space-y-3'>
      <h2 className='text-sm font-medium text-gray-500 uppercase tracking-wider'>История платежей</h2>
      <div className='bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b border-gray-100 bg-gray-50 text-left'>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Дата</th>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Заказ</th>
              <th className='px-4 py-2.5 font-medium text-gray-600'>Способ</th>
              <th className='px-4 py-2.5 font-medium text-gray-600 text-right'>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className='border-b border-gray-50 last:border-b-0 hover:bg-[#FFF7ED]'>
                <td className='px-4 py-2.5 text-gray-500'>{fmtDate(p.paidAt)}</td>
                <td className='px-4 py-2.5'>
                  <Link href={`/organization/orders/${p.orderId}`} className='text-[#F97316] hover:underline'>
                    {p.orderNumber ?? '—'}
                  </Link>
                </td>
                <td className='px-4 py-2.5 text-gray-600'>
                  {p.isRefund ? <span className='text-red-600'>Возврат</span> : (p.method ?? '—')}
                </td>
                <td className={`px-4 py-2.5 text-right font-medium ${p.isRefund ? 'text-red-600' : 'text-gray-800'}`}>
                  {p.isRefund ? '−' : ''}
                  {fmtMoney(p.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
