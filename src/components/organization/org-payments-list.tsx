import type { OrgOrderPayment } from '@/lib/services/organization/orders';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(s)) + ' ₽';
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(d);
}

const METHOD_LABELS: Record<string, string> = {
  bank: 'Банковский перевод',
  cash: 'Наличные',
  card: 'Карта',
  other: 'Прочее'
};

export function OrgPaymentsList({ payments }: { payments: OrgOrderPayment[] }) {
  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
      <h2 className='text-sm font-semibold text-[#111111]'>
        Оплаты {payments.length > 0 && (
          <span className='text-gray-400 font-normal'>({payments.length})</span>
        )}
      </h2>

      {payments.length === 0 ? (
        <p className='text-sm text-gray-500'>Оплат по заказу пока нет.</p>
      ) : (
        <ul className='divide-y divide-gray-100'>
          {payments.map((p) => (
            <li key={p.id} className='py-2 flex items-center justify-between gap-3'>
              <div className='min-w-0 flex-1'>
                <div className='text-sm text-[#111111] font-medium'>
                  {p.isRefund ? 'Возврат ' : ''}
                  {fmtMoney(p.amount)}
                </div>
                <div className='text-xs text-gray-500 mt-0.5'>
                  {fmtDate(p.paidAt)}
                  {p.method && <span> · {METHOD_LABELS[p.method] ?? p.method}</span>}
                </div>
                {p.note && <div className='text-xs text-gray-400 mt-0.5'>{p.note}</div>}
              </div>
              {p.isRefund && (
                <span className='text-[10px] uppercase tracking-wider text-red-700 bg-red-50 border border-red-100 rounded px-1.5 py-0.5'>
                  Возврат
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
