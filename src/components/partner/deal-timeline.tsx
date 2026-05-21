import type { DealDetail } from '@/lib/services/partner/dealDetail';

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(d);
}

export function DealTimeline({ deal }: { deal: DealDetail }) {
  const events: { label: string; date: Date | null; tone?: 'success' | 'warning' }[] = [
    { label: 'Создана', date: deal.createdAt },
    { label: 'Договор подписан', date: deal.contractSignedAt },
    { label: 'Дедлайн', date: deal.deadline, tone: 'warning' },
    { label: 'Завершена', date: deal.completedAt, tone: 'success' },
    { label: 'Оплачена', date: deal.paidAt, tone: 'success' },
    { label: 'Закрыта', date: deal.closedAt }
  ];

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
      <h2 className='text-sm font-semibold text-[#111111]'>Даты</h2>
      <ul className='space-y-2'>
        {events.map((e) => {
          const passed = e.date !== null;
          return (
            <li key={e.label} className='flex items-center gap-3 text-sm'>
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  !passed
                    ? 'bg-gray-200'
                    : e.tone === 'success'
                    ? 'bg-green-500'
                    : e.tone === 'warning'
                    ? 'bg-orange-400'
                    : 'bg-gray-400'
                }`}
              />
              <span className={`flex-1 ${passed ? 'text-[#111111]' : 'text-gray-400'}`}>
                {e.label}
              </span>
              <span
                className={`text-xs ${
                  passed ? 'text-gray-500 font-medium' : 'text-gray-300'
                }`}
              >
                {fmtDate(e.date)}
              </span>
            </li>
          );
        })}
      </ul>
      {deal.lastSyncedAt && (
        <div className='text-[10px] text-gray-400 pt-2 border-t border-gray-100'>
          Обновлено из 1С: {new Intl.DateTimeFormat('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          }).format(deal.lastSyncedAt)}
        </div>
      )}
    </div>
  );
}
