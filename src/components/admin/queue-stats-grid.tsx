import React from 'react';
import type { QueueStatsRow } from '@/lib/services/admin/queueStats';

function badgeClass(value: number, kind: 'failed' | 'active' | 'neutral'): string {
  if (kind === 'failed' && value > 0) return 'bg-red-50 text-red-700';
  if (kind === 'active' && value > 0) return 'bg-blue-50 text-blue-700';
  return 'bg-gray-50 text-gray-600';
}

export function QueueStatsGrid({ rows }: { rows: QueueStatsRow[] }) {
  return (
    <div className='overflow-x-auto bg-white border border-gray-200 rounded-xl'>
      <table className='w-full text-sm'>
        <thead className='bg-gray-50 text-gray-600'>
          <tr>
            <th scope='col' className='text-left px-4 py-3 font-medium'>Очередь</th>
            <th scope='col' className='text-right px-4 py-3 font-medium'>Ожидают</th>
            <th scope='col' className='text-right px-4 py-3 font-medium'>Активные</th>
            <th scope='col' className='text-right px-4 py-3 font-medium'>Отложены</th>
            <th scope='col' className='text-right px-4 py-3 font-medium'>Завершено</th>
            <th scope='col' className='text-right px-4 py-3 font-medium'>Сбоев</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.queue} className='border-t border-gray-100'>
              <td className='px-4 py-3 text-[#111111] font-mono text-xs'>{row.queue}</td>
              <td className='px-4 py-3 text-right tabular-nums'>{row.counts.waiting}</td>
              <td className='px-4 py-3 text-right tabular-nums'>
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${badgeClass(row.counts.active, 'active')}`}>
                  {row.counts.active}
                </span>
              </td>
              <td className='px-4 py-3 text-right tabular-nums text-gray-500'>{row.counts.delayed}</td>
              <td className='px-4 py-3 text-right tabular-nums text-gray-400'>{row.counts.completed}</td>
              <td className='px-4 py-3 text-right tabular-nums'>
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${badgeClass(row.counts.failed, 'failed')}`}>
                  {row.counts.failed}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
