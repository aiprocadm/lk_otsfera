import React from 'react';
import type { SyncSummaryRow } from '@/lib/services/syncSummary';
import type { QueueStatsRow } from '@/lib/services/admin/queueStats';
import { defaultPatternFor, DEFAULT_SYNC_TZ } from '@/lib/jobs/scheduling';
import type { SchedulePatterns } from '@/lib/services/admin/syncSchedules';
import type { SettingKey, SettingViewRow } from '@/lib/config/integrationSettings';
import { SyncScheduleEditor } from '@/components/admin/sync-schedule-editor';
import { OneCParamsForm } from '@/components/admin/one-c-params-form';
import { saveOneCParamsAction } from '@/server-actions/admin/syncControl';
import { SYNC_ENTITIES, type SyncControlEntity } from '@/lib/services/admin/syncControl';
import { CardList, Card, CardRow } from '@/components/ui/card-list';
import type { PendingRecordRow } from '@/lib/services/admin/pendingRecords';
import { SyncTriggerButton } from '@/components/admin/sync-trigger-button';
import { SyncScheduleToggle } from '@/components/admin/sync-schedule-toggle';
import { SyncCursorDialog } from '@/components/admin/sync-cursor-dialog';
import { PendingRecordsSection } from '@/components/admin/pending-records-section';
import type { SettingsCabinet } from '@/lib/navigation/settings';

import { PageHeader } from '@/components/ui/page-header';
/**
 * Вкладка «Автообмен» экрана «Обмен с 1С» — одна на кабинет администратора и
 * кабинет руководителя (`У-118`, закрывает дефект `Д-33`).
 *
 * Компонент **презентационный**: данные приходят пропсами, в базу он не ходит
 * (правило `components-no-db`). Выборки делает страница своей роли — админская
 * грузит и админские секции (очередь разбора, компании), страница руководителя
 * их даже не запрашивает.
 *
 * У руководителя этой вкладки не существовало: переключатель её показывал, а
 * клик приводил на «страница не найдена». При вставшем обмене руководитель
 * ничего не мог ни увидеть, ни сделать.
 *
 * Что различается и почему:
 *
 * | Возможность | Админ | Руководитель |
 * |---|---|---|
 * | Состояние расписаний, «сейчас выполняется» | да | да |
 * | Ручной запуск | да | да |
 * | Пауза расписания, перемотка курсора | да | нет |
 * | Прочие фоновые задачи, очередь разбора | да | нет |
 *
 * Пауза и курсор — рычаги платформенные: обмен с 1С один на все компании, и
 * остановка расписания задевает чужие данные. Запуск же означает «сходить за
 * свежими данными сейчас» — последствия обратимы.
 */
/** `У-125`: параметры обмена, которые правит администратор (страницы грузят их через `getSettingsView`). */
export const ONEC_PARAM_KEYS: SettingKey[] = [
  'onec.mode',
  'onec.httpTimeoutMs',
  'onec.cursorOverlapMinutes',
  'onec.defaultCompanyId',
  'onec.pendingMaxAttempts',
  'onec.pendingMaxAgeDays',
];

const ENTITY_RU: Record<SyncSummaryRow['entity'], string> = {
  organization: 'Организации',
  order: 'Заказы',
  payment: 'Платежи',
  document: 'Документы',
};

/**
 * Отдельные cron-задачи вне 1С-синка. Результаты видны не здесь, а в своих
 * разделах — поэтому у каждой подписан адрес результата. Тумблер паузы здесь не
 * выводится: у `certExpiry`/`commissions` его нет by design, а `email`/`mango`
 * управляются как 1С-синки на сервисном уровне.
 */
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

function RunningBadge({ active }: { active: number }) {
  return active > 0 ? (
    <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
      выполняется
    </span>
  ) : (
    <span className="text-gray-400 text-xs">—</span>
  );
}

export function OneCAutoExchange({
  cabinet,
  rows,
  queueStats,
  pausedIds,
  pendingRecords,
  patterns,
  paramsView,
  companies,
}: {
  cabinet: SettingsCabinet;
  rows: SyncSummaryRow[];
  queueStats: QueueStatsRow[];
  pausedIds: ReadonlySet<string>;
  /** Очередь разбора — админская; страница руководителя передаёт пустой список. */
  pendingRecords: PendingRecordRow[];
  patterns: SchedulePatterns;
  paramsView: SettingViewRow[];
  /** Компании для формы параметров — тоже только у админа. */
  companies: Array<{ id: string; name: string }>;
}) {
  const isAdmin = cabinet === 'admin';

  const paramOf = (key: string) => paramsView.find((r) => r.key === key)?.value ?? '';
  const patternOf = (schedulerId: string) =>
    patterns.get(schedulerId) ?? defaultPatternFor(schedulerId) ?? '—';

  const activeByQueue = new Map(queueStats.map((q) => [q.queue, q.counts.active]));

  return (
    <div className="space-y-5">
      <div>
        <PageHeader
          title="Автообмен"
          subtitle={
            isAdmin ? (
              <>
                {' '}
                Запуск, пауза расписания и перемотка курсора по сущностям. Bulk-retry упавших задач
                —{' '}
                <a href="/admin/settings/system/health" className="text-[#F97316] hover:underline">
                  {' '}
                  на странице Здоровья{' '}
                </a>{' '}
                .{' '}
              </>
            ) : (
              'Состояние обмена по расписанию и ручной запуск, когда данные нужны прямо сейчас.'
            )
          }
        />
      </div>

      <div className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <span aria-hidden className="mr-1">
          ℹ️
        </span>
        Это автоматический обмен с 1С по сети: программа сама забирает организации, заказы, оплаты и
        документы по расписанию. Здесь файлы не загружаются — для ручной загрузки используйте
        «Загрузка Excel» или «Выписка по счёту 51».
      </div>

      {/* `У-18`: широкая таблица на телефоне превращается в карточки. */}
      <CardList>
        {rows.map((r) => {
          const cfg = SYNC_ENTITIES[r.entity as SyncControlEntity];
          const active = activeByQueue.get(cfg.queueName) ?? 0;
          const paused = pausedIds.has(cfg.schedulerId);
          return (
            <Card key={r.entity} title={ENTITY_RU[r.entity]}>
              <CardRow label="Последний успех">{formatDate(r.lastSuccessAt)}</CardRow>
              <CardRow label="Сейчас">{active > 0 ? 'выполняется' : '—'}</CardRow>
              {!isAdmin && <CardRow label="Расписание">{paused ? 'на паузе' : 'работает'}</CardRow>}
              <div className="pt-2 flex flex-wrap gap-2">
                <SyncTriggerButton entity={r.entity} />
                {isAdmin && (
                  <>
                    <SyncScheduleToggle schedulerId={cfg.schedulerId} paused={paused} />
                    <SyncCursorDialog entity={r.entity} currentCursor={r.cursor ?? null} />
                    <SyncScheduleEditor
                      schedulerId={cfg.schedulerId}
                      tz={DEFAULT_SYNC_TZ}
                      current={patternOf(cfg.schedulerId)}
                      isDefault={!patterns.has(cfg.schedulerId)}
                    />
                  </>
                )}
                {!isAdmin && (
                  <span className="text-xs text-gray-500 self-center">
                    Расписание: <code className="font-mono">{patternOf(cfg.schedulerId)}</code>
                  </span>
                )}
              </div>
            </Card>
          );
        })}
        <Card title="Сверка (reconcile)">
          <CardRow label="Последний успех">—</CardRow>
          <CardRow label="Сейчас">
            {(activeByQueue.get('oneCSync.reconcile') ?? 0) > 0 ? 'выполняется' : '—'}
          </CardRow>
          {!isAdmin && (
            <CardRow label="Расписание">
              {pausedIds.has('oneCSync.reconcile.cron') ? 'на паузе' : 'работает'}
            </CardRow>
          )}
          <div className="pt-2 flex flex-wrap gap-2">
            <SyncTriggerButton entity="reconcile" />
            {isAdmin && (
              <SyncScheduleToggle
                schedulerId="oneCSync.reconcile.cron"
                paused={pausedIds.has('oneCSync.reconcile.cron')}
              />
            )}
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
              {isAdmin && (
                <th scope="col" className="text-left px-4 py-3 font-medium">
                  Курсор
                </th>
              )}
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
                    <RunningBadge active={active} />
                  </td>
                  <td className="px-4 py-3">
                    <SyncTriggerButton entity={r.entity} />
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <SyncScheduleToggle schedulerId={cfg.schedulerId} paused={paused} />
                    ) : (
                      <span className="text-xs text-gray-500">
                        {paused ? 'на паузе' : 'работает'}
                      </span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <SyncCursorDialog entity={r.entity} currentCursor={r.cursor ?? null} />
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="border-t border-gray-100 bg-gray-50/50">
              <td className="px-4 py-3 text-[#111111] font-medium">Сверка (reconcile)</td>
              <td className="px-4 py-3 text-gray-400">—</td>
              <td className="px-4 py-3">
                <RunningBadge active={activeByQueue.get('oneCSync.reconcile') ?? 0} />
              </td>
              <td className="px-4 py-3">
                <SyncTriggerButton entity="reconcile" />
              </td>
              <td className="px-4 py-3">
                {isAdmin ? (
                  <SyncScheduleToggle
                    schedulerId="oneCSync.reconcile.cron"
                    paused={pausedIds.has('oneCSync.reconcile.cron')}
                  />
                ) : (
                  <span className="text-xs text-gray-500">
                    {pausedIds.has('oneCSync.reconcile.cron') ? 'на паузе' : 'работает'}
                  </span>
                )}
              </td>
              {isAdmin && <td className="px-4 py-3 text-gray-400 text-xs">нет курсора</td>}
            </tr>
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <>
          <div>
            <h2 className="text-lg font-semibold text-[#111111]">Прочие фоновые задачи</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Ручной запуск cron-задач вне 1С-синка. Результаты выполнения — в соответствующих
              разделах: сертификаты → уведомления, почта → инбокс, Mango → звонки, комиссии →
              ведомости.
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
                        {patternOf(SYNC_ENTITIES[job.entity].schedulerId)}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <RunningBadge
                        active={activeByQueue.get(SYNC_ENTITIES[job.entity].queueName) ?? 0}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <SyncTriggerButton entity={job.entity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* `У-125`: параметры обмена — форма у администратора. */}
          <OneCParamsForm
            initial={{
              mode: paramOf('onec.mode') || 'live',
              httpTimeoutMs: paramOf('onec.httpTimeoutMs'),
              cursorOverlapMinutes: paramOf('onec.cursorOverlapMinutes'),
              defaultCompanyId: paramOf('onec.defaultCompanyId'),
              pendingMaxAttempts: paramOf('onec.pendingMaxAttempts'),
              pendingMaxAgeDays: paramOf('onec.pendingMaxAgeDays'),
            }}
            companies={companies}
            action={saveOneCParamsAction}
          />

          <PendingRecordsSection records={pendingRecords} />
        </>
      )}

      {/* `У-125`: руководитель видит те же параметры — только на чтение. */}
      {!isAdmin && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[#111111] mb-3">Параметры обмена</h2>
          <CardList>
            <Card title="Как настроено">
              <CardRow label="Режим">
                {(paramOf('onec.mode') || 'live') === 'shadow'
                  ? 'теневой — в 1С не пишем'
                  : 'боевой — читаем и пишем'}
              </CardRow>
              <CardRow label="Таймаут запроса">
                {paramOf('onec.httpTimeoutMs') || '15000'} мс
              </CardRow>
              <CardRow label="Перекрытие курсора">
                {paramOf('onec.cursorOverlapMinutes') || '5'} мин
              </CardRow>
            </Card>
          </CardList>
          <p className="text-xs text-gray-400 mt-2">
            Обмен с 1С один на всю платформу, поэтому его параметры меняет администратор.
          </p>
        </div>
      )}
    </div>
  );
}
