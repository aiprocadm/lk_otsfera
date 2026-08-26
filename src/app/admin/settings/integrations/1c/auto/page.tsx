import type { Metadata } from 'next';
import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { getSyncSummary } from '@/lib/services/syncSummary';
import { getQueueStats } from '@/lib/services/admin/queueStats';
import { loadPausedSchedulerIds } from '@/lib/jobs/scheduling';
import { getSchedulePatterns } from '@/lib/services/admin/syncSchedules';
import { getSettingsView } from '@/lib/config/integrationSettings';
import { listPendingRecords, type PendingRecordRow } from '@/lib/services/admin/pendingRecords';
import { listCompanyOptions } from '@/lib/services/admin/orders';
import { OneCAutoExchange, ONEC_PARAM_KEYS } from '@/components/settings/one-c-auto-exchange';

export const metadata: Metadata = { title: 'Автообмен · Обмен с 1С' };

export const dynamic = 'force-dynamic';

/**
 * «Автообмен» администратора. Экран общий с кабинетом руководителя (`У-118`);
 * база — здесь, в слое app: компонент презентационный (`components-no-db`).
 */
export default async function AdminSyncPage() {
  const session = await requireSettingsSection('integrations.oneC', 'admin');

  const [rows, queueStats, pausedIds, pendingRecords, patterns, paramsView, companies] =
    await Promise.all([
      getSyncSummary(prisma),
      getQueueStats().catch(() => []),
      loadPausedSchedulerIds(prisma).catch(() => new Set<string>()),
      // Очередь разбора — админская (сервис отвечает `forbidden` остальным).
      // Сбой БД деградирует в пустую секцию, как соседние загрузки (§3).
      listPendingRecords(prisma, session)
        .then((r) => (r.ok ? r.records : []))
        .catch(() => [] as PendingRecordRow[]),
      // `У-125`: расписание и параметры — из базы, с умолчаниями из кода.
      getSchedulePatterns(prisma).catch(() => new Map<string, string>()),
      getSettingsView(prisma, ONEC_PARAM_KEYS).catch(() => []),
      listCompanyOptions(prisma).catch(() => [] as Array<{ id: string; name: string }>),
    ]);

  return (
    <OneCAutoExchange
      cabinet="admin"
      rows={rows}
      queueStats={queueStats}
      pausedIds={pausedIds}
      pendingRecords={pendingRecords}
      patterns={patterns}
      paramsView={paramsView}
      companies={companies}
    />
  );
}
