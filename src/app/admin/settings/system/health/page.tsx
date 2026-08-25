import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { getSyncLag, type SyncLagRow } from '@/lib/services/admin/syncHealth';
import { getQueueStats, getDlq } from '@/lib/services/admin/queueStats';
import { listAlertStates, type AlertStateRow } from '@/lib/services/admin/alerts';
import { listSyncErrors, type SyncErrorRow } from '@/lib/services/syncSummary';
import { QueueStatsGrid } from '@/components/admin/queue-stats-grid';
import { DlqTable } from '@/components/admin/dlq-table';
import { RetryAllButton } from '@/components/admin/retry-all-button';
import { AlertsSection } from '@/components/admin/alerts-section';
import { SyncErrorsSection } from '@/components/admin/sync-errors-section';

import { PageHeader } from '@/components/ui/page-header';
export const metadata: Metadata = { title: 'Здоровье системы · Настройки' };

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
  const session = await requireSettingsSection('system.health', 'admin');

  // Sync stats hit Postgres; queues hit Redis. Failure of one shouldn't
  // hide the other — wrap each branch in a per-section guard so the page
  // still renders something useful even if Redis is down for maintenance.
  const [syncRows, queueRows, dlqRows, alertRows, syncErrorRows] = await Promise.all([
    getSyncLag(prisma).catch(() => [] as SyncLagRow[]),
    getQueueStats().catch(() => []),
    getDlq().catch(() => []),
    // forbidden после requireAdmin недостижим, но контракт Result требует ветку;
    // сбой БД деградирует в пустую секцию, как соседние загрузки.
    listAlertStates(prisma, session)
      .then((r) => (r.ok ? r.alerts : []))
      .catch(() => [] as AlertStateRow[]),
    listSyncErrors(prisma).catch(() => [] as SyncErrorRow[]),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          title="Здоровье системы"
          subtitle="Свежесть синхронизации с 1С, глубина BullMQ очередей и список упавших задач, алерты и последние ошибки синхронизации."
        />
      </div>

      {/* Алерты первыми: firing — самый высокосигнальный блок страницы */}
      <AlertsSection alerts={alertRows} />

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[#111111]">Лаг синхронизации</h2>
        <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th scope="col" className="text-left px-4 py-3 font-medium">
                  Сущность
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  Лаг
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  Успехов 24ч
                </th>
                <th scope="col" className="text-right px-4 py-3 font-medium">
                  Ошибок 24ч
                </th>
              </tr>
            </thead>
            <tbody>
              {syncRows.map((row) => (
                <tr key={row.entity} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-[#111111] font-medium">{ENTITY_RU[row.entity]}</td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${lagBadgeClass(row.lagMs)}`}
                    >
                      {lagLabel(row.lagMs)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {row.successCount24h}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${row.errorCount24h > 0 ? 'text-red-700' : 'text-gray-400'}`}
                  >
                    {row.errorCount24h}
                  </td>
                </tr>
              ))}
              {syncRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                    Данные о синхронизации сейчас недоступны.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[#111111]">Глубина очередей</h2>
        {queueRows.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-sm text-gray-500">
            Очереди недоступны — проверьте Redis.
          </div>
        ) : (
          <QueueStatsGrid rows={queueRows} />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#111111]">Упавшие задачи (последние 50)</h2>
        </div>
        {[...new Set(dlqRows.map((r) => r.queue))].length > 0 && (
          <div className="flex flex-wrap gap-2">
            {[...new Set(dlqRows.map((r) => r.queue))].map((q) => (
              <div
                key={q}
                className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5"
              >
                <span className="font-mono text-xs text-gray-600">{q}</span>
                <RetryAllButton queue={q} />
              </div>
            ))}
          </div>
        )}
        <DlqTable rows={dlqRows} />
      </section>

      <SyncErrorsSection errors={syncErrorRows} />
    </div>
  );
}
