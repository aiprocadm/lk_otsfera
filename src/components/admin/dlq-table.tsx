import type { DlqRow } from '@/lib/services/admin/queueStats';
import { RetryButton } from './retry-button';

function ageLabel(d: Date | null): string {
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}м`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч`;
  return `${Math.floor(h / 24)}д`;
}

export function DlqTable({ rows }: { rows: DlqRow[] }) {
  if (rows.length === 0) {
    return (
      <div className='bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-sm text-gray-500'>
        Все очереди чисты — ни одной упавшей задачи.
      </div>
    );
  }
  return (
    <div className='overflow-x-auto bg-white border border-gray-200 rounded-xl'>
      <table className='w-full text-sm'>
        <thead className='bg-gray-50 text-gray-600'>
          <tr>
            <th className='text-left px-4 py-3 font-medium'>Очередь</th>
            <th className='text-left px-4 py-3 font-medium'>Job ID</th>
            <th className='text-left px-4 py-3 font-medium'>Имя</th>
            <th className='text-left px-4 py-3 font-medium'>Причина</th>
            <th className='text-right px-4 py-3 font-medium'>Попыток</th>
            <th className='text-right px-4 py-3 font-medium'>Когда</th>
            <th className='text-right px-4 py-3 font-medium'>Действие</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.queue}:${row.jobId}`} className='border-t border-gray-100'>
              <td className='px-4 py-3 font-mono text-xs text-gray-600'>{row.queue}</td>
              <td className='px-4 py-3 font-mono text-xs text-gray-500'>{row.jobId}</td>
              <td className='px-4 py-3 text-gray-700'>{row.name}</td>
              <td className='px-4 py-3 text-red-700 text-xs max-w-md'>
                <span className='line-clamp-2'>{row.failedReason ?? '—'}</span>
              </td>
              <td className='px-4 py-3 text-right tabular-nums text-gray-600'>{row.attemptsMade}</td>
              <td className='px-4 py-3 text-right text-gray-500 text-xs'>{ageLabel(row.failedAt)}</td>
              <td className='px-4 py-3 text-right'>
                <RetryButton queue={row.queue} jobId={row.jobId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
