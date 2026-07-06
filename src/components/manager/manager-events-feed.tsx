import React from 'react';
import Link from 'next/link';
import type { EventItem } from '@/lib/services/manager/dashboard';
import { fmtDateTime } from '@/lib/format';

export function ManagerEventsFeed({ events }: { events: EventItem[] }) {
  if (events.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500'>
        Нет событий за последний период.
      </div>
    );
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Последние события</h2>
      <ul className='space-y-2 text-sm'>
        {events.map((e) => {
          const content = (
            <>
              <span className='flex-1 min-w-0 truncate'>{e.text}</span>
              <span className='text-gray-400 text-xs whitespace-nowrap'>
                {fmtDateTime(e.when)}
              </span>
            </>
          );
          return (
            <li key={e.id} className='flex items-center justify-between gap-3'>
              {e.href ? (
                <Link
                  href={e.href}
                  className='text-gray-700 hover:text-[#F97316] flex items-center justify-between gap-3 flex-1 min-w-0'
                >
                  {content}
                </Link>
              ) : (
                <div className='text-gray-700 flex items-center justify-between gap-3 flex-1 min-w-0'>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
