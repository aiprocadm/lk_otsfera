import type { Job } from 'bullmq';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import type { BitrixImportJobPayload } from '@/lib/jobs/types';
import { bestEffort, log } from '@/lib/logging';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { recordAudit } from '@/lib/auth/audit';
import { getBitrixSource } from '@/lib/services/bitrix/factory';
import { runPipeline, type PipelineResult } from '@/lib/services/bitrix/pipeline';
import { filterOf, type BitrixBatchSettings } from '@/lib/services/bitrix/preview';
import { storeBitrixReport } from '@/lib/services/bitrix/report';
import { runRollback } from '@/lib/services/bitrix/rollback';
import type { BitrixSource } from '@/lib/services/bitrix/source';

/**
 * Пакет миграции из Битрикс24 (`У-193`, `У-194`, спека §3.2).
 *
 * Одна очередь на три задачи: `preview` — сухой прогон, `apply` — запись
 * (PR-4), `rollback` — откат (PR-5). Что именно делать, говорит `job.name`.
 *
 * Флаг проверяется в начале КАЖДОЙ задачи (`У-202`): выключили миграцию —
 * пакет останавливается с понятной причиной, а не молча висит в очереди.
 * Ошибка прогона не роняет задачу в повтор: повторять сухой прогон по кругу
 * бессмысленно, пока человек не поправит настройки, — пакет переходит в
 * `failed` с текстом, который видно на экране.
 */
export type BitrixImportDeps = {
  getSource: (
    prisma: PrismaClient,
    batch: { source: string; settings: unknown }
  ) => Promise<BitrixSource>;
};

const defaultDeps: BitrixImportDeps = { getSource: getBitrixSource };

export type BitrixImportResult = {
  batchId: string;
  status: 'preview' | 'applied' | 'rolled_back' | 'rollback_partial' | 'failed' | 'skipped';
  reason?: string;
};

export async function bitrixImportProcessor(
  job: Job<BitrixImportJobPayload>,
  db: PrismaClient = prisma,
  deps: BitrixImportDeps = defaultDeps
): Promise<BitrixImportResult> {
  const { batchId } = job.data;
  const kind = job.name;
  log.info('[worker] bitrix-import job started', { id: job.id, kind, batchId });

  const batch = await db.bitrixImportBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      companyId: true,
      importedById: true,
      source: true,
      status: true,
      settings: true,
    },
  });
  if (!batch) {
    log.warn('[worker] bitrix-import: пакет не найден', { batchId });
    return { batchId, status: 'skipped', reason: 'пакет не найден' };
  }

  await primeIntegrationSettingsCache(db);
  if (!isFeatureEnabled('bitrix_migration')) {
    return fail(db, batchId, 'Миграция из Битрикс24 выключена в настройках платформы');
  }

  if (kind === 'rollback') return rollback(db, batch);
  if (kind !== 'preview' && kind !== 'apply') {
    // Незнакомая задача не должна молча исчезать — пакет говорит, что произошло.
    return fail(db, batchId, `Задача «${kind}» не поддерживается`);
  }

  const settings = batch.settings as unknown as BitrixBatchSettings;
  const applying = kind === 'apply';
  await db.bitrixImportBatch.update({
    where: { id: batchId },
    data: { status: applying ? 'applying' : 'preview_pending', startedAt: new Date() },
  });

  let result: PipelineResult;
  try {
    const source = await deps.getSource(db, { source: batch.source, settings: batch.settings });
    result = await runPipeline(db, {
      batch: {
        id: batch.id,
        companyId: batch.companyId,
        importedById: batch.importedById,
        filter: filterOf(settings),
        withFiles: settings.withFiles !== false,
        defaultManagerId: settings.defaultManagerId ?? null,
        tables: settings.tables ?? {},
      },
      source,
      mode: applying ? 'live' : 'shadow',
      // Прогресс — единственное, что видно человеку во время долгого прогона;
      // но его потеря не повод ронять сам прогон (§3, degrade gracefully).
      onProgress: async (progress) => {
        await db.bitrixImportBatch
          .update({
            where: { id: batchId },
            data: { counts: { progress } as unknown as Prisma.InputJsonValue },
          })
          .catch(bestEffort('[worker] bitrix-import: прогресс не записан'));
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`[worker] bitrix-import ${kind} failed`, { batchId, message });
    return fail(db, batchId, message);
  }

  const nextSettings: BitrixBatchSettings = {
    ...settings,
    tables: result.tables,
    stagesFound: result.stagesFound,
    usersFound: result.usersFound,
    rows: result.rows,
  };

  await db.bitrixImportBatch.update({
    where: { id: batchId },
    data: {
      status: applying ? 'applied' : 'preview',
      counts: result.counts as unknown as Prisma.InputJsonValue,
      errors: result.errors as unknown as Prisma.InputJsonValue,
      settings: nextSettings as unknown as Prisma.InputJsonValue,
      ...(applying ? { appliedAt: new Date() } : {}),
    },
  });

  // Отчёт сверки (`У-198`) собирается по журналу — после того, как записи
  // сделаны. Его сбой не отменяет перенос: путь просто не появится у пакета.
  if (applying) await storeBitrixReport(db, batchId);

  await recordAudit(db, {
    userId: batch.importedById,
    action: applying ? 'bitrix_import_applied' : 'bitrix_import_previewed',
    entity: 'bitrix_import_batch',
    entityId: batchId,
    after: applying
      ? { total: result.counts.total, errors: result.errors.length }
      : { total: result.counts.total, ready: result.ready },
  });

  log.info(`[worker] bitrix-import ${kind} done`, { batchId, total: result.counts.total });
  return { batchId, status: applying ? 'applied' : 'preview' };
}

/**
 * Откат пакета (`У-196`). Идёт порциями внутри `runRollback`, поэтому здесь
 * остаётся только записать итог: статус, дату, конфликты в настройки (их
 * покажет отчёт сверки) и аудит.
 */
async function rollback(
  db: PrismaClient,
  batch: {
    id: string;
    companyId: string;
    importedById: string;
    status: string;
    settings: Prisma.JsonValue;
  }
): Promise<BitrixImportResult> {
  const batchId = batch.id;
  let summary: Awaited<ReturnType<typeof runRollback>>;
  try {
    summary = await runRollback(db, batchId, async (progress) => {
      await db.bitrixImportBatch
        .update({
          where: { id: batchId },
          data: { counts: { rollback: progress } as unknown as Prisma.InputJsonValue },
        })
        .catch(bestEffort('[worker] bitrix-import: прогресс отката не записан'));
    });
  } catch (err) {
    // Откат не состоялся целиком (база недоступна, прогон убит). Статус
    // возвращаем ПРЕЖНИЙ, а не `failed`: иначе пакет навсегда остался бы без
    // кнопки «Откатить» — `failed` для неё выглядит как «не применяли», и
    // повторить откат было бы нечем. Причина уходит в ошибки пакета.
    const message = err instanceof Error ? err.message : String(err);
    log.warn('[worker] bitrix-import rollback failed', { batchId, message });
    await db.bitrixImportBatch.update({
      where: { id: batchId },
      data: {
        status: batch.status,
        errors: [{ bitrixId: '—', entity: 'batch', message }] as unknown as Prisma.InputJsonValue,
      },
    });
    return { batchId, status: 'failed', reason: message };
  }

  const settings = (batch.settings ?? {}) as unknown as BitrixBatchSettings;
  await db.bitrixImportBatch.update({
    where: { id: batchId },
    data: {
      status: summary.status,
      rolledBackAt: new Date(),
      errors: summary.errors as unknown as Prisma.InputJsonValue,
      settings: {
        ...settings,
        rollbackConflicts: summary.conflicts,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  await storeBitrixReport(db, batchId);

  await recordAudit(db, {
    userId: batch.importedById,
    action: 'bitrix_import_rolled_back',
    entity: 'bitrix_import_batch',
    entityId: batchId,
    after: {
      status: summary.status,
      deleted: summary.deleted,
      restored: summary.restored,
      unlinked: summary.unlinked,
      conflicts: summary.conflicts.length,
      errors: summary.errors.length,
    },
  });

  log.info('[worker] bitrix-import rollback done', { batchId, status: summary.status });
  return { batchId, status: summary.status };
}

async function fail(
  db: PrismaClient,
  batchId: string,
  reason: string
): Promise<BitrixImportResult> {
  await db.bitrixImportBatch.update({
    where: { id: batchId },
    data: {
      status: 'failed',
      errors: [
        { bitrixId: '—', entity: 'batch', message: reason },
      ] as unknown as Prisma.InputJsonValue,
    },
  });
  return { batchId, status: 'failed', reason };
}
