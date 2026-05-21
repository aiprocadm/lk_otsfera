import type { DashboardEvent } from '@/lib/services/partner/dashboard';

const kindIcon: Record<DashboardEvent['kind'], string> = {
  order_updated: '📋',
  lead_created: '👤',
  payment_received: '💰'
};

export function EventsFeed({ events }: { events: DashboardEvent[] }) {
  if (events.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>
        Пока тут пусто — события появятся когда начнётся работа.
      </div>
    );
  }
  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Последние события</h2>
      <ul className='space-y-2 text-sm'>
        {events.map((e, i) => (
          <li key={i} className='flex items-center justify-between gap-3'>
            <span className='text-gray-700'>
              <span className='mr-1'>{kindIcon[e.kind]}</span>
              {e.title}
            </span>
            <span className='text-gray-400 text-xs whitespace-nowrap'>{e.at.toLocaleString('ru-RU')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
