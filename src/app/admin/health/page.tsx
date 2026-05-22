import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { getSyncLag, type SyncLagRow } from '@/lib/services/admin/syncHealth';
import { getQueueStats, getDlq } from '@/lib/services/admin/queueStats';
import { QueueStatsGrid } from '@/components/admin/queue-stats-grid';
import { DlqTable } from '@/components/admin/dlq-table';

export const dynamic = 'force-dynamic';

const ENTITY_RU: Record<SyncLagRow['entity'], string> = {
  organization: 'Организации',
  order: 'Заказы',
  payment: 'Платежи',
  document: 'Документы',
};

function lagLabel(lagMs: number | null): string {
  if (lagMs === null) return '—';
  const s = Math.floor(lagMs / 1000);
  if (s < 60) return `${s}с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}м`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч`;
  return `${Math.floor(h / 24)}д`;
}

function lagBadgeClass(lagMs: number | null): string {
  if (lagMs === null) return 'bg-gray-100 text-gray-500';
  if (lagMs <= 2 * 60 * 60 * 1000) return 'bg-green-50 text-green-700';
  if (lagMs <= 24 * 60 * 60 * 1000) return 'bg-yellow-50 text-yellow-700';
  return 'bg-red-50 text-red-700';
}

export default async function AdminHealthPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/login');

  // Sync stats hit Postgres; queues hit Redis. Failure of one shouldn't
  // hide the other — wrap each branch in a per-section guard so the page
  // still renders something useful even if Redis is down for maintenance.
  const [syncRows, queueRows, dlqRows] = await Promise.all([
    getSyncLag(prisma).catch(() => [] as SyncLagRow[]),
    getQueueStats().catch(() => []),
    getDlq().catch(() => []),
  ]);

  return (
    <div className='space-y-8'>
      <div>
        <h1 className='text-2xl font-bold text-[#111111]'>Здоровье системы</h1>
        <p className='text-sm text-gray-500 mt-0.5'>
          Свежесть синхронизации с 1С, глубина BullMQ очередей и список упавших задач.
        </p>
      </div>

      <section className='space-y-3'>
        <h2 className='text-base font-semibold text-[#111111]'>Лаг синхронизации</h2>
        <div className='overflow-x-auto bg-white border border-gray-200 rounded-xl'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50 text-gray-600'>
              <tr>
                <th className='text-left px-4 py-3 font-medium'>Сущность</th>
                <th className='text-right px-4 py-3 font-medium'>Лаг</th>
                <th className='text-right px-4 py-3 font-medium'>Успехов 24ч</th>
                <th className='text-right px-4 py-3 font-medium'>Ошибок 24ч</th>
              </tr>
            </thead>
            <tbody>
              {syncRows.map((row) => (
                <tr key={row.entity} className='border-t border-gray-100'>
                  <td className='px-4 py-3 text-[#111111] font-medium'>{ENTITY_RU[row.entity]}</td>
                  <td className='px-4 py-3 text-right'>
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${lagBadgeClass(row.lagMs)}`}>
                      {lagLabel(row.lagMs)}
                    </span>
                  </td>
                  <td className='px-4 py-3 text-right tabular-nums text-gray-700'>{row.successCount24h}</td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${row.errorCount24h > 0 ? 'text-red-700' : 'text-gray-400'}`}
                  >
                    {row.errorCount24h}
                  </td>
                </tr>
              ))}
              {syncRows.length === 0 && (
                <tr>
                  <td colSpan={4} className='px-4 py-8 text-center text-sm text-gray-500'>
                    Данные о синхронизации сейчас недоступны.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className='space-y-3'>
        <h2 className='text-base font-semibold text-[#111111]'>Глубина очередей</h2>
        {queueRows.length === 0 ? (
          <div className='bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-sm text-gray-500'>
            Очереди недоступны — проверьте Redis.
          </div>
        ) : (
          <QueueStatsGrid rows={queueRows} />
        )}
      </section>

      <section className='space-y-3'>
        <h2 className='text-base font-semibold text-[#111111]'>Упавшие задачи (последние 50)</h2>
        <DlqTable rows={dlqRows} />
      </section>
    </div>
  );
}
