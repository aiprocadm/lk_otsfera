import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { getSyncSummary } from '@/lib/services/syncSummary';
import { getQueueStats } from '@/lib/services/admin/queueStats';
import { loadPausedSchedulerIds } from '@/lib/jobs/scheduling';
import { getSchedulePatterns } from '@/lib/services/admin/syncSchedules';
import { getSettingsView } from '@/lib/config/integrationSettings';
import { OneCAutoExchange, ONEC_PARAM_KEYS } from '@/components/settings/one-c-auto-exchange';

export const metadata: Metadata = { title: 'Автообмен · Обмен с 1С' };

export const dynamic = 'force-dynamic';

/**
 * «Автообмен» руководителя (`У-118`, дефект `Д-33`). Вкладка была видна, но
 * вела на «страница не найдена»: при вставшем обмене руководитель не мог ни
 * посмотреть состояние, ни запустить обмен руками. Экран тот же, что у админа;
 * пауза расписания и перемотка курсора остаются админскими — они платформенные.
 * База — здесь, в слое app (`components-no-db`); админские выборки (очередь
 * разбора, компании) эта страница даже не запрашивает.
 */
export default async function LeaderSyncPage() {
  await requireSettingsSection('integrations.oneC', 'leader');

  const [rows, queueStats, pausedIds, patterns, paramsView] = await Promise.all([
    getSyncSummary(prisma),
    getQueueStats().catch(() => []),
    loadPausedSchedulerIds(prisma).catch(() => new Set<string>()),
    // `У-125`: расписание и параметры — из базы, с умолчаниями из кода.
    getSchedulePatterns(prisma).catch(() => new Map<string, string>()),
    getSettingsView(prisma, ONEC_PARAM_KEYS).catch(() => []),
  ]);

  return (
    <OneCAutoExchange
      cabinet="leader"
      rows={rows}
      queueStats={queueStats}
      pausedIds={pausedIds}
      pendingRecords={[]}
      pendingTotal={0}
      patterns={patterns}
      paramsView={paramsView}
      companies={[]}
    />
  );
}
