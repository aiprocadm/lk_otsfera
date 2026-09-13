import type { Metadata } from 'next';
import React from 'react';
import { notFound } from 'next/navigation';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { resolveFunnelStages } from '@/lib/funnel/stages';
import { resolveDealStages } from '@/lib/services/deals/stages';
import { resolveTaskColumns } from '@/lib/tasks/columns';
import { getBitrixBatch } from '@/lib/services/bitrix/preview';
import { unmappedStages } from '@/lib/services/bitrix/mapping/stages';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { BATCH_STATUS_LABELS, formatDate } from '@/components/bitrix/batch-list';
import { BatchProgress } from '@/components/bitrix/batch-progress';
import { BatchRows } from '@/components/bitrix/batch-rows';
import { BatchSummary } from '@/components/bitrix/batch-summary';
import { MappingTables } from '@/components/bitrix/mapping-tables';
import { BITRIX_BATCHES } from '@/components/bitrix/hrefs';
import { BackLink } from '@/components/ui/back-link';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = { title: 'Пакет миграции из Битрикс24 · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * Карточка пакета (`У-193`): что получится, о чём нужно решить и куда что ляжет.
 *
 * Экран отвечает на три вопроса сразу: сверху — состояние пакета и откуда
 * данные, в середине — сводка и таблицы сопоставления, внизу — строки, которые
 * не перенесутся. Кнопка применения появится следующим шагом этапа, и об этом
 * сказано прямо: молчащая кнопка хуже честной подписи.
 */
export default async function AdminBitrixBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const session = await requireSettingsSection('integrations.bitrix', 'admin');
  const { batchId } = await params;
  const res = await getBitrixBatch(prisma, session, batchId);
  if (!res.ok) notFound();

  const batch = res.batch;
  const companyId = session.companyId ?? '';
  const [dealStages, funnelStages, taskColumns, managers] = await Promise.all([
    resolveDealStages(prisma, companyId),
    resolveFunnelStages(prisma, companyId),
    resolveTaskColumns(prisma, companyId),
    companyId ? listCompanyManagers(prisma, companyId) : Promise.resolve([]),
  ]);

  const stages = batch.settings.stagesFound ?? [];
  const users = batch.settings.usersFound ?? [];
  const rows = batch.settings.rows ?? [];
  const tables = batch.settings.tables;
  const missing = unmappedStages(stages, tables.stageMap ?? {}, tables.leadStageMap ?? {});

  return (
    <div className="space-y-4">
      <BackLink href={BITRIX_BATCHES} label="К пакетам" />
      <PageHeader
        title={`Пакет от ${formatDate(batch.createdAt)}`}
        subtitle={`${BATCH_STATUS_LABELS[batch.status] ?? batch.status} · запустил ${batch.importedByName} · ${
          batch.source === 'file' ? 'из загруженных выгрузок' : 'с портала по вебхуку'
        }`}
      />

      <BatchProgress batchId={batch.id} status={batch.status} />

      {batch.status === 'failed' && (
        <div role="alert" className="bg-white border border-red-200 rounded-xl p-4 space-y-1">
          <div className="text-sm font-medium text-red-700">Пакет не посчитался</div>
          <ul className="text-sm text-gray-700 list-disc pl-5">
            {batch.errors.map((e, i) => (
              <li key={`${e.bitrixId}-${i}`}>{e.message}</li>
            ))}
          </ul>
          <p className="text-sm text-gray-600">
            Поправьте настройки на вкладке «Подключение» или загрузите выгрузки заново и создайте
            пакет ещё раз.
          </p>
        </div>
      )}

      {batch.counts && (
        <>
          {batch.counts.warnings.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              {batch.counts.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}
          <BatchSummary counts={batch.counts} />
        </>
      )}

      {batch.status === 'preview' && stages.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="font-medium text-gray-900">Сопоставление</h2>
            <p className="text-sm text-gray-600">
              Битрикс и кабинет называют стадии по-разному. Выберите, куда что кладём, — без этого
              переносить нельзя.
            </p>
          </div>
          <MappingTables
            batchId={batch.id}
            stages={stages}
            users={users}
            dealStages={dealStages.map((s) => ({ id: s.id, name: s.name }))}
            funnelStages={funnelStages.map((s) => ({ id: s.id, name: s.name }))}
            taskColumns={taskColumns.map((c) => ({ id: c.id, name: c.name }))}
            companyUsers={managers
              .filter((m) => m.isActive)
              .map((m) => ({ id: m.id, name: m.name }))}
            values={{
              stageMap: tables.stageMap ?? {},
              leadStageMap: tables.leadStageMap ?? {},
              taskColumnMap: tables.taskColumnMap ?? {},
              userMap: tables.userMap ?? {},
            }}
          />
        </section>
      )}

      {batch.status === 'preview' && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-1">
          <div className="text-sm font-medium text-[#111111]">Применение</div>
          {missing.length > 0 ? (
            <p className="text-sm text-gray-600">
              Сначала сопоставьте стадии: {missing.join(', ')}. Пока это не сделано, перенос
              запустить нельзя — записи ушли бы не туда.
            </p>
          ) : (
            <p className="text-sm text-gray-600">
              Сопоставление готово. Кнопка «Применить» появится следующим шагом этапа — вместе с
              записью, журналом и откатом.
            </p>
          )}
        </div>
      )}

      {rows.length > 0 && <BatchRows rows={rows} />}
    </div>
  );
}
