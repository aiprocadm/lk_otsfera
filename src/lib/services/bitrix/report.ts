import type { Prisma, PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { log } from '@/lib/logging';
import { getObjectStorage } from '@/lib/storage';
import {
  appendOverflowNotice,
  EXPORT_ROW_LIMIT,
  formatDateRu,
  safeText,
  styleHeader,
} from '@/lib/services/export/xlsx';
import { BITRIX_ENTITIES, BITRIX_ENTITY_TITLES, type BitrixEntity } from './mapping/types';
import { ROW_CAP } from './pipeline';
import { ROLLBACK_CONFLICT_LABELS, type RollbackConflict } from './rollback';
import type { BitrixBatchSettings } from './preview';

/**
 * Отчёт сверки переноса (`У-198`, спека §3.7).
 *
 * Это главный документ приёмки: по нему человек убеждается, что в ЛК приехало
 * ровно то, что было в Битрикс24. Поэтому отчёт строится НЕ из счётчиков, а из
 * журнала записей — того же, по которому идёт откат. Счётчик можно посчитать
 * неправильно; журнал — это то, что действительно произошло с базой.
 *
 * Лист на сущность плюс три листа «что не поехало и почему»: конфликты,
 * пропуски и поля, оставленные человеку правилом §3.4. Молчаливое «остальное
 * не перенеслось» — ровно то, ради чего отчёт и делается.
 */
const SHEET_ORDER: BitrixEntity[] = [...BITRIX_ENTITIES];

/** Русские подписи действий журнала — в отчёт не должны попадать коды. */
const ACTION_LABELS: Record<string, string> = {
  created: 'создано',
  updated: 'обновлено',
  linked: 'связано',
};

const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type JournalRow = {
  entity: string;
  entityId: string;
  bitrixId: string;
  action: string;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  reverted: boolean;
};

type BatchRow = {
  id: string;
  companyId: string;
  status: string;
  createdAt: Date;
  appliedAt: Date | null;
  rolledBackAt: Date | null;
  settings: Prisma.JsonValue;
  importedBy: { name: string | null };
};

/** `Json` → «поле: значение» одной строкой. Пустой снимок — прочерк. */
export function fieldsText(value: Prisma.JsonValue): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '—';
  const parts = Object.entries(value).map(([key, raw]) => `${key}: ${textOf(raw)}`);
  return parts.length > 0 ? safeText(parts.join('; ')) : '—';
}

function textOf(raw: unknown): string {
  if (raw === null || raw === undefined) return '—';
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  return JSON.stringify(raw);
}

/**
 * Книга отчёта. Читает журнал и настройки пакета; ничего не пишет.
 * Возвращает буфер — кто его положит в хранилище, решает вызывающий.
 */
export async function buildBitrixReport(
  prisma: PrismaClient,
  batchId: string
): Promise<Buffer | null> {
  const batch = (await prisma.bitrixImportBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      companyId: true,
      status: true,
      createdAt: true,
      appliedAt: true,
      rolledBackAt: true,
      settings: true,
      importedBy: { select: { name: true } },
    },
  })) as BatchRow | null;
  if (!batch) return null;

  const settings = (batch.settings ?? {}) as Partial<BitrixBatchSettings>;
  const planRows = settings.rows ?? [];
  const rollbackConflicts = settings.rollbackConflicts ?? [];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';

  addSummarySheet(wb, batch);
  for (const entity of SHEET_ORDER) {
    const rows = (await prisma.bitrixImportWrite.findMany({
      where: { batchId, entity },
      orderBy: { createdAt: 'asc' },
      take: EXPORT_ROW_LIMIT,
      select: {
        entity: true,
        entityId: true,
        bitrixId: true,
        action: true,
        before: true,
        after: true,
        reverted: true,
      },
    })) as JournalRow[];
    const total = await prisma.bitrixImportWrite.count({ where: { batchId, entity } });
    addEntitySheet(wb, entity, rows, total);
  }

  addConflictsSheet(wb, planRows, rollbackConflicts);
  addSkippedSheet(wb, planRows);
  addKeptManualSheet(wb, planRows);

  // Типы ExcelJS объявляют writeBuffer() под DOM-ArrayBuffer; в Node рантайме
  // возвращается Node Buffer (зеркало каста в commission/xlsx.ts).
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

function addSummarySheet(wb: ExcelJS.Workbook, batch: BatchRow): void {
  const ws = wb.addWorksheet('Сводка');
  ws.columns = [
    { header: 'Показатель', key: 'label', width: 28 },
    { header: 'Значение', key: 'value', width: 44 },
  ];
  styleHeader(ws, true);
  ws.addRow({ label: 'Пакет', value: safeText(batch.id) });
  ws.addRow({ label: 'Запустил', value: safeText(batch.importedBy.name ?? '—') });
  ws.addRow({ label: 'Создан', value: formatDateRu(batch.createdAt) });
  ws.addRow({ label: 'Применён', value: formatDateRu(batch.appliedAt) });
  ws.addRow({ label: 'Откачен', value: formatDateRu(batch.rolledBackAt) });
  ws.addRow({ label: 'Состояние', value: safeText(batch.status) });
}

function addEntitySheet(
  wb: ExcelJS.Workbook,
  entity: BitrixEntity,
  rows: JournalRow[],
  total: number
): void {
  const ws = wb.addWorksheet(BITRIX_ENTITY_TITLES[entity]);
  ws.columns = [
    { header: 'ID в Битрикс24', key: 'bitrixId', width: 18 },
    { header: 'ID в ЛК', key: 'entityId', width: 28 },
    { header: 'Действие', key: 'action', width: 14 },
    { header: 'Было', key: 'before', width: 50 },
    { header: 'Стало', key: 'after', width: 50 },
    { header: 'Откачено', key: 'reverted', width: 12 },
  ];
  styleHeader(ws, rows.length > 0);
  for (const row of rows) {
    ws.addRow({
      bitrixId: safeText(row.bitrixId),
      entityId: safeText(row.entityId),
      action: safeText(ACTION_LABELS[row.action] ?? row.action),
      before: fieldsText(row.before),
      after: fieldsText(row.after),
      reverted: row.reverted ? 'да' : 'нет',
    });
  }
  appendOverflowNotice(ws, { total, noticeKey: 'entityId' });
}

function addConflictsSheet(
  wb: ExcelJS.Workbook,
  planRows: NonNullable<BitrixBatchSettings['rows']>,
  rollbackConflicts: RollbackConflict[]
): void {
  const ws = wb.addWorksheet('Конфликты');
  ws.columns = [
    { header: 'Этап', key: 'stage', width: 12 },
    { header: 'Сущность', key: 'entity', width: 18 },
    { header: 'ID в Битрикс24', key: 'bitrixId', width: 18 },
    { header: 'ID в ЛК', key: 'entityId', width: 28 },
    { header: 'Что за запись', key: 'title', width: 40 },
    { header: 'Причина', key: 'reason', width: 60 },
  ];
  const planConflicts = planRows.filter((r) => r.action === 'conflict');
  styleHeader(ws, planConflicts.length + rollbackConflicts.length > 0);
  for (const row of planConflicts) {
    ws.addRow({
      stage: 'Перенос',
      entity: BITRIX_ENTITY_TITLES[row.entity],
      bitrixId: safeText(row.bitrixId),
      // Записи в ЛК ещё нет — конфликт переноса тем и означает, что её не
      // завели. Прочерк честнее пустой ячейки: её приняли бы за потерю.
      entityId: '—',
      title: safeText(row.title),
      reason: safeText(row.reason ?? '—'),
    });
  }
  for (const conflict of rollbackConflicts) {
    ws.addRow({
      stage: 'Откат',
      entity: BITRIX_ENTITY_TITLES[conflict.entity],
      bitrixId: '—',
      // Без идентификатора записи в ЛК её пришлось бы искать по названию —
      // а названия повторяются. Число ссылок говорит, сколько работы легло.
      entityId: safeText(conflict.entityId),
      title: safeText(conflict.label),
      reason: safeText(
        `${ROLLBACK_CONFLICT_LABELS[conflict.code] ?? conflict.code} (${conflict.count})`
      ),
    });
  }
  noteIfCapped(ws, planConflicts.length, planRows.length);
}

function addSkippedSheet(
  wb: ExcelJS.Workbook,
  planRows: NonNullable<BitrixBatchSettings['rows']>
): void {
  const ws = wb.addWorksheet('Пропущено');
  ws.columns = [
    { header: 'Сущность', key: 'entity', width: 18 },
    { header: 'ID в Битрикс24', key: 'bitrixId', width: 18 },
    { header: 'Что за запись', key: 'title', width: 40 },
    { header: 'Причина', key: 'reason', width: 60 },
  ];
  const skipped = planRows.filter((r) => r.action === 'skip');
  styleHeader(ws, skipped.length > 0);
  for (const row of skipped) {
    ws.addRow({
      entity: BITRIX_ENTITY_TITLES[row.entity],
      bitrixId: safeText(row.bitrixId),
      title: safeText(row.title),
      reason: safeText(row.reason ?? '—'),
    });
  }
  noteIfCapped(ws, skipped.length, planRows.length);
}

/** Префикс, которым конвейер помечает поля, оставленные человеку (§3.4). */
export const KEPT_MANUAL_PREFIX = 'оставлено ручное значение: ';

function addKeptManualSheet(
  wb: ExcelJS.Workbook,
  planRows: NonNullable<BitrixBatchSettings['rows']>
): void {
  const ws = wb.addWorksheet('Оставлено ручное');
  ws.columns = [
    { header: 'Сущность', key: 'entity', width: 18 },
    { header: 'ID в Битрикс24', key: 'bitrixId', width: 18 },
    { header: 'Что за запись', key: 'title', width: 40 },
    { header: 'Поля', key: 'fields', width: 60 },
  ];
  const kept = planRows.filter((r) => (r.reason ?? '').startsWith(KEPT_MANUAL_PREFIX));
  styleHeader(ws, kept.length > 0);
  for (const row of kept) {
    ws.addRow({
      entity: BITRIX_ENTITY_TITLES[row.entity],
      bitrixId: safeText(row.bitrixId),
      title: safeText(row.title),
      // Причина здесь заведомо есть: на лист попали только строки, чья
      // причина начинается с префикса. `?? ''` был бы мёртвой веткой.
      fields: safeText(row.reason!.slice(KEPT_MANUAL_PREFIX.length)),
    });
  }
  noteIfCapped(ws, kept.length, planRows.length);
}

/**
 * Строки «нужно решение» конвейер обрезает на `ROW_CAP` (§3.8 спеки). Молчать
 * об этом нельзя: человек решил бы, что пропусков ровно столько, и выключил
 * бы Битрикс24 с неполной картиной.
 */
function noteIfCapped(ws: ExcelJS.Worksheet, shown: number, planRows: number): void {
  if (planRows < ROW_CAP) return;
  ws.addRow({});
  ws.addRow({
    title: `Показаны ${shown} строк из первых ${ROW_CAP}, которые запомнил предпросмотр: остальные того же рода. Все записи целиком — на листах сущностей.`,
  });
}

/** Ключ отчёта в хранилище. Метка времени — чтобы откат не затирал перенос. */
export function reportKey(batchId: string, stamp: Date): string {
  return `bitrix-import/${batchId}/report-${stamp.toISOString().replace(/[:.]/g, '-')}.xlsx`;
}

/**
 * Собрать отчёт и положить в хранилище, запомнив путь в пакете. Зовётся в
 * конце применения и в конце отката — не fail-fast: перенос уже состоялся, и
 * ронять его из-за недоступного хранилища нельзя. Сбой видно в логе, а кнопка
 * «Отчёт» останется неактивной.
 */
export async function storeBitrixReport(
  prisma: PrismaClient,
  batchId: string
): Promise<string | null> {
  try {
    const buffer = await buildBitrixReport(prisma, batchId);
    if (!buffer) return null;
    const key = reportKey(batchId, new Date());
    await getObjectStorage().upload(key, buffer, { contentType: CONTENT_TYPE });
    await prisma.bitrixImportBatch.update({ where: { id: batchId }, data: { reportPath: key } });
    return key;
  } catch (e) {
    log.error('[bitrix/report] отчёт сверки не собран', {
      batchId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
