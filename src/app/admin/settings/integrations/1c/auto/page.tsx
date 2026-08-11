import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { getSyncSummary, type SyncSummaryRow } from '@/lib/services/syncSummary';
import { getQueueStats } from '@/lib/services/admin/queueStats';
import { loadPausedSchedulerIds } from '@/lib/jobs/scheduling';
import { SYNC_ENTITIES, type SyncControlEntity } from '@/lib/services/admin/syncControl';
import { CardList, Card, CardRow } from '@/components/ui/card-list';
import { listPendingRecords, type PendingRecordRow } from '@/lib/services/admin/pendingRecords';
import { SyncTriggerButton } from '@/components/admin/sync-trigger-button';
import { SyncScheduleToggle } from '@/components/admin/sync-schedule-toggle';
import { SyncCursorDialog } from '@/components/admin/sync-cursor-dialog';
import { PendingRecordsSection } from '@/components/admin/pending-records-section';

export const metadata: Metadata = { title: 'Автообмен · Обмен с 1С' };

export const dynamic = 'force-dynamic';

const ENTITY_RU: Record<SyncSummaryRow['entity'], string> = {
  organization: 'Организации',
  order: 'Заказы',
  payment: 'Платежи',
  document: 'Документы',
};

// G3: standalone cron-джобы с ручным запуском. Результаты — не на этой странице,
// а в целевых разделах (см. resultHint). Тумблер паузы в этой секции не выводится:
// certExpiry/commissions — пауза невозможна by design (их schedulerId нет в
// SYNC_SCHEDULES), email/mango — управляются как 1С-синки на сервисном уровне.
const BACKGROUND_JOBS: ReadonlyArray<{
  entity: SyncControlEntity;
  label: string;
  resultHint: string;
}> = [
  {
    entity: 'certificateExpiry',
    label: 'Напоминания об истечении удостоверений',
    resultHint: 'уведомления',
  },
  { entity: 'emailPoll', label: 'Поллинг входящей почты', resultHint: 'инбокс' },
  { entity: 'mangoBackfill', label: 'Бэкфилл звонков Mango', resultHint: 'звонки' },
  { entity: 'monthlyCommissions', label: 'Расчёт ежемесячных комиссий', resultHint: 'ведомости' },
];

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export default async function AdminSyncPage() {
  const session = await requireSettingsSection('integrations.oneC', 'admin');

  const [rows, queueStats, pausedIds, pendingRecords] = await Promise.all([
    getSyncSummary(prisma),
    getQueueStats().catch(() => []),
    loadPausedSchedulerIds(prisma).catch(() => new Set<string>()),
    // forbidden после requireAdmin недостижим, но контракт Result требует ветку;
    // сбой БД деградирует в пустую секцию, как соседние загрузки.
    listPendingRecords(prisma, session)
      .then((r) => (r.ok ? r.records : []))
      .catch(() => [] as PendingRecordRow[]),
  ]);

  const activeByQueue = new Map(queueStats.map((q) => [q.queue, q.counts.active]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Синхронизация с 1С (авто)</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Запуск, пауза расписания и перемотка курсора по сущностям. Bulk-retry упавших задач —{' '}
          <a href="/admin/settings/system/health" className="text-[#F97316] hover:underline">
            на странице Здоровья
          </a>
          .
        </p>
      </div>

      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Это автоматический обмен с 1С по сети: программа сама забирает организации, заказы, оплаты и
        документы по расписанию. Здесь файлы не загружаются — для ручной загрузки файла используйте
        «Загрузка Excel» или «Импорт выписки (сч. 51)».
      </div>

      {/* У-18: шесть колонок — на телефоне карточки. */}
      <CardList>
        {rows.map((r) => {
          const cfg = SYNC_ENTITIES[r.entity as SyncControlEntity];
          const active = activeByQueue.get(cfg.queueName) ?? 0;
          const paused = pausedIds.has(cfg.schedulerId);
          return (
            <Card key={r.entity} title={ENTITY_RU[r.entity]}>
              <CardRow label="Последний успех">{formatDate(r.lastSuccessAt)}</CardRow>
              <CardRow label="Сейчас">{active > 0 ? 'выполняется' : '—'}</CardRow>
              <div className="pt-2 flex flex-wrap gap-2">
                <SyncTriggerButton entity={r.entity} />
                <SyncScheduleToggle schedulerId={cfg.schedulerId} paused={paused} />
                <SyncCursorDialog entity={r.entity} currentCursor={r.cursor ?? null} />
              </div>
            </Card>
          );
        })}
        <Card title="Сверка (reconcile)">
          <CardRow label="Последний успех">—</CardRow>
          <CardRow label="Сейчас">
            {(activeByQueue.get('oneCSync.reconcile') ?? 0) > 0 ? 'выполняется' : '—'}
          </CardRow>
          <div className="pt-2 flex flex-wrap gap-2">
            <SyncTriggerButton entity="reconcile" />
            <SyncScheduleToggle
              schedulerId="oneCSync.reconcile.cron"
              paused={pausedIds.has('oneCSync.reconcile.cron')}
            />
          </div>
        </Card>
      </CardList>

      <div className="hidden md:block overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th scope="col" className="text-left px-4 py-3 font-medium">
                Сущность
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium">
                Последний успех
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium">
                Сейчас
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium">
                Запуск
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium">
                Расписание
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium">
                Курсор
              </th>
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
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                        выполняется
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <SyncTriggerButton entity={r.entity} />
                  </td>
                  <td className="px-4 py-3">
                    <SyncScheduleToggle schedulerId={cfg.schedulerId} paused={paused} />
                  </td>
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
                  <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                    выполняется
                  </span>
                ) : (
                  <span className="text-gray-400 text-xs">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <SyncTriggerButton entity="reconcile" />
              </td>
              <td className="px-4 py-3">
                <SyncScheduleToggle
                  schedulerId="oneCSync.reconcile.cron"
                  paused={pausedIds.has('oneCSync.reconcile.cron')}
                />
              </td>
              <td className="px-4 py-3 text-gray-400 text-xs">нет курсора</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-[#111111]">Прочие фоновые задачи</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Ручной запуск cron-задач вне 1С-синка. Результаты выполнения — в соответствующих разделах:
          сертификаты → уведомления, почта → инбокс, Mango → звонки, комиссии → ведомости.
        </p>
      </div>

      <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th scope="col" className="text-left px-4 py-3 font-medium">
                Задача
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium">
                Расписание (cron)
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium">
                Сейчас
              </th>
              <th scope="col" className="text-left px-4 py-3 font-medium">
                Запуск
              </th>
            </tr>
          </thead>
          <tbody>
            {BACKGROUND_JOBS.map((job) => (
              <tr key={job.entity} className="border-t border-gray-100">
                <td className="px-4 py-3">
                  <div className="text-[#111111] font-medium">{job.label}</div>
                  <div className="text-xs text-gray-400">
                    результаты — раздел «{job.resultHint}»
                  </div>
                </td>
                <td className="px-4 py-3">
                  <code className="text-xs text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded">
                    {SYNC_ENTITIES[job.entity].cronLabel}
                  </code>
                </td>
                <td className="px-4 py-3">
                  {(activeByQueue.get(SYNC_ENTITIES[job.entity].queueName) ?? 0) > 0 ? (
                    <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                      выполняется
                    </span>
                  ) : (
                    <span className="text-gray-400 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <SyncTriggerButton entity={job.entity} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PendingRecordsSection records={pendingRecords} />
    </div>
  );
}
