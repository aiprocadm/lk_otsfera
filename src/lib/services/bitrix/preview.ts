import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { getQueue } from '@/lib/jobs/queues';
import { bestEffort } from '@/lib/logging';
import type { BitrixMappingTables } from './mapping/types';
import { stageMapComplete } from './mapping/stages';
import type { PipelineCounts, PipelineResult } from './pipeline';
import type { RollbackConflict } from './rollback';
import type { BitrixStage, SourceFilter } from './source';

/**
 * Пакет миграции: создание, чтение и правка таблиц сопоставления (`У-193`).
 *
 * Вся работа делается в фоновой задаче, поэтому сервис короткий: он заводит
 * строку пакета, кладёт задачу в очередь и отдаёт состояние экрану. Пакет
 * привязан к компании сотрудника — чужой пакет для него не существует
 * (`not_found`, а не «нет доступа»: существование чужих пакетов не наше дело).
 */
export type BitrixBatchStatus =
  | 'preview_pending'
  | 'preview'
  | 'applying'
  | 'applied'
  | 'rolling_back'
  | 'rolled_back'
  | 'rollback_partial'
  | 'failed';

export type BitrixBatchSettings = {
  from: string | null;
  to: string | null;
  openOnly: boolean;
  withFiles: boolean;
  defaultManagerId: string | null;
  fileKeys: { key: string; name: string; entity: string }[];
  tables: Partial<BitrixMappingTables>;
  /** Что нашёл сухой прогон — экран рисует из этого таблицы сопоставления. */
  stagesFound?: BitrixStage[];
  usersFound?: PipelineResult['usersFound'];
  rows?: PipelineResult['rows'];
  /** Чего не смог вернуть откат (`У-196`) — уезжает в отчёт сверки. */
  rollbackConflicts?: RollbackConflict[];
};

export type BitrixBatchView = {
  id: string;
  status: BitrixBatchStatus;
  source: string;
  mode: string;
  createdAt: Date;
  startedAt: Date | null;
  appliedAt: Date | null;
  rolledBackAt: Date | null;
  /** Отчёт сверки уже собран — кнопка «Отчёт» активна (`У-198`). */
  hasReport: boolean;
  importedByName: string;
  settings: BitrixBatchSettings;
  counts: PipelineCounts | null;
  errors: { bitrixId: string; entity: string; message: string }[];
  /** Можно ли применять: сухой прогон прошёл и все стадии сопоставлены. */
  ready: boolean;
};

type BitrixBatchError = 'forbidden' | 'not_found' | 'invalid' | 'mapping_incomplete';

export type BitrixBatchResult<T> = { ok: true } & T;
export type BitrixBatchFail = { ok: false; error: BitrixBatchError };

export type CreateBatchArgs = {
  source: 'rest' | 'file';
  from: string;
  to: string;
  openOnly: boolean;
  withFiles: boolean;
  defaultManagerId: string;
  fileKeys: { key: string; name: string; entity: string }[];
};

const EMPTY_TABLES: Partial<BitrixMappingTables> = {};

function readSettings(raw: Prisma.JsonValue | null): BitrixBatchSettings {
  const value = (raw ?? {}) as Partial<BitrixBatchSettings>;
  return {
    from: value.from ?? null,
    to: value.to ?? null,
    openOnly: value.openOnly === true,
    withFiles: value.withFiles !== false,
    defaultManagerId: value.defaultManagerId ?? null,
    fileKeys: Array.isArray(value.fileKeys) ? value.fileKeys : [],
    tables: value.tables ?? EMPTY_TABLES,
    ...(value.stagesFound ? { stagesFound: value.stagesFound } : {}),
    ...(value.usersFound ? { usersFound: value.usersFound } : {}),
    ...(value.rows ? { rows: value.rows } : {}),
    ...(value.rollbackConflicts ? { rollbackConflicts: value.rollbackConflicts } : {}),
  };
}

/** Период пакета в виде фильтра источника; пустые границы — «вся история». */
export function filterOf(settings: BitrixBatchSettings): SourceFilter {
  const from = settings.from ? new Date(settings.from) : null;
  const to = settings.to ? new Date(settings.to) : null;
  return {
    ...(from && !Number.isNaN(from.getTime()) ? { from } : {}),
    ...(to && !Number.isNaN(to.getTime()) ? { to } : {}),
    openOnly: settings.openOnly,
  };
}

export async function createBitrixBatch(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateBatchArgs
): Promise<BitrixBatchResult<{ batchId: string }> | BitrixBatchFail> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };
  if (args.source !== 'rest' && args.source !== 'file') return { ok: false, error: 'invalid' };
  if (args.source === 'file' && args.fileKeys.length === 0) return { ok: false, error: 'invalid' };

  const settings: BitrixBatchSettings = {
    from: args.from || null,
    to: args.to || null,
    openOnly: args.openOnly,
    withFiles: args.withFiles,
    defaultManagerId: args.defaultManagerId || null,
    fileKeys: args.fileKeys,
    tables: EMPTY_TABLES,
  };

  const batch = await prisma.bitrixImportBatch.create({
    data: {
      companyId: session.companyId,
      importedById: session.sub,
      source: args.source,
      mode: 'initial',
      status: 'preview_pending',
      settings: settings as unknown as Prisma.InputJsonValue,
      counts: {} as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  // Очередь недоступна — пакет всё равно создан и виден: человек нажмёт
  // «Повторить предпросмотр», когда воркер поднимется (§3 CLAUDE.md).
  await getQueue('bitrix.import')
    .add('preview', { batchId: batch.id })
    .catch(bestEffort('[bitrix/preview] enqueue failed'));

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'bitrix_import_previewed',
    entity: 'bitrix_import_batch',
    entityId: batch.id,
    after: { source: args.source, openOnly: args.openOnly, withFiles: args.withFiles },
  });

  return { ok: true, batchId: batch.id };
}

const BATCH_SELECT = {
  id: true,
  companyId: true,
  status: true,
  source: true,
  mode: true,
  createdAt: true,
  startedAt: true,
  appliedAt: true,
  rolledBackAt: true,
  reportPath: true,
  settings: true,
  counts: true,
  errors: true,
  importedBy: { select: { name: true } },
} as const;

function toView(row: {
  id: string;
  status: string;
  source: string;
  mode: string;
  createdAt: Date;
  startedAt: Date | null;
  appliedAt: Date | null;
  rolledBackAt: Date | null;
  reportPath: string | null;
  settings: Prisma.JsonValue;
  counts: Prisma.JsonValue;
  errors: Prisma.JsonValue | null;
  importedBy: { name: string };
}): BitrixBatchView {
  const settings = readSettings(row.settings);
  const counts = (row.counts ?? null) as PipelineCounts | null;
  const stages = settings.stagesFound ?? [];
  const tables = settings.tables;
  return {
    id: row.id,
    status: row.status as BitrixBatchStatus,
    source: row.source,
    mode: row.mode,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    appliedAt: row.appliedAt,
    rolledBackAt: row.rolledBackAt,
    hasReport: !!row.reportPath,
    importedByName: row.importedBy.name,
    settings,
    counts: counts && Object.keys(counts).length > 0 ? counts : null,
    errors: Array.isArray(row.errors) ? (row.errors as BitrixBatchView['errors']) : [],
    ready:
      row.status === 'preview' &&
      stages.length > 0 &&
      stageMapComplete(stages, tables.stageMap ?? {}, tables.leadStageMap ?? {}),
  };
}

export async function getBitrixBatch(
  prisma: PrismaClient,
  session: SessionPayload,
  batchId: string
): Promise<BitrixBatchResult<{ batch: BitrixBatchView }> | BitrixBatchFail> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };
  const row = await prisma.bitrixImportBatch.findUnique({
    where: { id: batchId },
    select: BATCH_SELECT,
  });
  if (!row || row.companyId !== session.companyId) return { ok: false, error: 'not_found' };
  return { ok: true, batch: toView(row) };
}

export async function listBitrixBatches(
  prisma: PrismaClient,
  session: SessionPayload,
  limit = 20
): Promise<BitrixBatchResult<{ batches: BitrixBatchView[] }> | BitrixBatchFail> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };
  const rows = await prisma.bitrixImportBatch.findMany({
    where: { companyId: session.companyId },
    select: BATCH_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return { ok: true, batches: rows.map(toView) };
}

/** Состояние пакета для опроса с экрана: минимум полей, без настроек. */
export async function getBitrixBatchState(
  prisma: PrismaClient,
  session: SessionPayload,
  batchId: string
): Promise<
  | BitrixBatchResult<{ status: BitrixBatchStatus; progress: PipelineCounts['progress'] }>
  | BitrixBatchFail
> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };
  const row = await prisma.bitrixImportBatch.findUnique({
    where: { id: batchId },
    select: { companyId: true, status: true, counts: true },
  });
  if (!row || row.companyId !== session.companyId) return { ok: false, error: 'not_found' };
  const counts = (row.counts ?? {}) as Partial<PipelineCounts>;
  return {
    ok: true,
    status: row.status as BitrixBatchStatus,
    progress: counts.progress ?? null,
  };
}

export async function saveBatchMapping(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { batchId: string; tables: Partial<BitrixMappingTables> }
): Promise<BitrixBatchResult<object> | BitrixBatchFail> {
  const current = await getBitrixBatch(prisma, session, args.batchId);
  if (!current.ok) return current;
  if (current.batch.status !== 'preview') return { ok: false, error: 'invalid' };

  const settings: BitrixBatchSettings = {
    ...current.batch.settings,
    tables: { ...current.batch.settings.tables, ...args.tables },
  };
  await prisma.bitrixImportBatch.update({
    where: { id: args.batchId },
    data: { settings: settings as unknown as Prisma.InputJsonValue },
  });
  return { ok: true };
}

/**
 * Проверка перед применением (`У-193`): пакет готов, только когда каждая стадия
 * портала получила стадию ЛК.
 */
export function batchReadyToApply(batch: BitrixBatchView): boolean {
  return batch.ready;
}

/**
 * «Применить»: тот же конвейер в режиме записи (`У-194`). Пакет уходит в
 * очередь и переходит в `applying` — дальше работает воркер, а экран
 * показывает прогресс.
 *
 * Несопоставленная стадия — жёсткий запрет: без неё сделки легли бы не туда,
 * и пришлось бы откатывать весь перенос.
 */
export async function applyBitrixBatch(
  prisma: PrismaClient,
  session: SessionPayload,
  batchId: string
): Promise<BitrixBatchResult<object> | BitrixBatchFail> {
  const current = await getBitrixBatch(prisma, session, batchId);
  if (!current.ok) return current;
  if (current.batch.status !== 'preview') return { ok: false, error: 'invalid' };
  if (!batchReadyToApply(current.batch)) return { ok: false, error: 'mapping_incomplete' };

  await prisma.bitrixImportBatch.update({
    where: { id: batchId },
    data: { status: 'applying' },
  });
  await getQueue('bitrix.import')
    .add('apply', { batchId })
    .catch(bestEffort('[bitrix/apply] enqueue failed'));

  return { ok: true };
}
