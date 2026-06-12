import Link from 'next/link';
import type { OrgEvent } from '@/lib/services/organization/dashboard';
import { fmtDateTime } from '@/lib/format';

const kindIcon: Record<OrgEvent['kind'], string> = {
  document_published: '📄',
  payment_received: '💰',
  order_status_changed: '📋',
  comment_posted: '💬'
};

export function OrgEventsFeed({ events }: { events: OrgEvent[] }) {
  if (events.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>
        Пока тут пусто — события появятся, когда начнётся работа по заказам.
      </div>
    );
  }
  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Последние события</h2>
      <ul className='space-y-2 text-sm'>
        {events.map((e) => (
          <li key={e.id} className='flex items-center justify-between gap-3'>
            {e.orderId ? (
              <Link
                href={`/organization/orders/${e.orderId}`}
                className='text-gray-700 hover:text-[#F97316] flex-1 min-w-0 truncate'
              >
                <span className='mr-1'>{kindIcon[e.kind]}</span>
                {e.title}
              </Link>
            ) : (
              <span className='text-gray-700 flex-1 min-w-0 truncate'>
                <span className='mr-1'>{kindIcon[e.kind]}</span>
                {e.title}
              </span>
            )}
            <span className='text-gray-400 text-xs whitespace-nowrap'>{fmtDateTime(e.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
