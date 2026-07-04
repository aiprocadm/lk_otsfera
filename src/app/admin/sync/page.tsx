import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import { getSyncSummary, type SyncSummaryRow } from '@/lib/services/syncSummary';
import { getQueueStats } from '@/lib/services/admin/queueStats';
import { loadPausedSchedulerIds } from '@/lib/jobs/scheduling';
import { SYNC_ENTITIES, type SyncControlEntity } from '@/lib/services/admin/syncControl';
import { SyncTriggerButton } from '@/components/admin/sync-trigger-button';
import { SyncScheduleToggle } from '@/components/admin/sync-schedule-toggle';
import { SyncCursorDialog } from '@/components/admin/sync-cursor-dialog';

export const dynamic = 'force-dynamic';

const ENTITY_RU: Record<SyncSummaryRow['entity'], string> = {
  organization: 'Организации',
  order: 'Заказы',
  payment: 'Платежи',
  document: 'Документы',
};

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

export default async function AdminSyncPage() {
  await requireAdmin();

  const [rows, queueStats, pausedIds] = await Promise.all([
    getSyncSummary(prisma),
    getQueueStats().catch(() => []),
    loadPausedSchedulerIds(prisma).catch(() => new Set<string>()),
  ]);

  const activeByQueue = new Map(queueStats.map((q) => [q.queue, q.counts.active]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Управление синхронизацией с 1С</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Запуск, пауза расписания и перемотка курсора по сущностям. Bulk-retry упавших задач —{' '}
          <a href="/admin/health" className="text-[#F97316] hover:underline">на странице Здоровья</a>.
        </p>
      </div>

      <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th scope='col' className="text-left px-4 py-3 font-medium">Сущность</th>
              <th scope='col' className="text-left px-4 py-3 font-medium">Последний успех</th>
              <th scope='col' className="text-left px-4 py-3 font-medium">Сейчас</th>
              <th scope='col' className="text-left px-4 py-3 font-medium">Запуск</th>
              <th scope='col' className="text-left px-4 py-3 font-medium">Расписание</th>
              <th scope='col' className="text-left px-4 py-3 font-medium">Курсор</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cfg = SYNC_ENTITIES[r.entity as SyncControlEntity];
              const active = activeByQueue.get(cfg.queueName) ?? 0;
              const paused = pausedIds.has(cfg.schedulerId);
              return (
                <tr key={r.entity} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-[#111111] font-medium">{ENTITY_RU[r.entity]}</td>
                  <td className="px-4 py-3 text-gray-700">{formatDate(r.lastSuccessAt)}</td>
                  <td className="px-4 py-3">
                    {active > 0 ? (
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">выполняется</span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><SyncTriggerButton entity={r.entity} /></td>
                  <td className="px-4 py-3"><SyncScheduleToggle schedulerId={cfg.schedulerId} paused={paused} /></td>
                  <td className="px-4 py-3">
                    <SyncCursorDialog entity={r.entity} currentCursor={r.cursor ?? null} />
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-gray-100 bg-gray-50/50">
              <td className="px-4 py-3 text-[#111111] font-medium">Сверка (reconcile)</td>
              <td className="px-4 py-3 text-gray-400">—</td>
              <td className="px-4 py-3">
                {(activeByQueue.get('oneCSync.reconcile') ?? 0) > 0 ? (
                  <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">выполняется</span>
                ) : (
                  <span className="text-gray-400 text-xs">—</span>
                )}
              </td>
              <td className="px-4 py-3"><SyncTriggerButton entity="reconcile" /></td>
              <td className="px-4 py-3">
                <SyncScheduleToggle schedulerId="oneCSync.reconcile.cron" paused={pausedIds.has('oneCSync.reconcile.cron')} />
              </td>
              <td className="px-4 py-3 text-gray-400 text-xs">нет курсора</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
