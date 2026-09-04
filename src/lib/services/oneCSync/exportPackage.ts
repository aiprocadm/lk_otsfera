import type { OneCPushStatus, Prisma, PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { recordAudit } from '@/lib/auth/audit';
import type { SessionPayload } from '@/lib/auth/jwt';
import { documentDownloadName } from '@/lib/documents/fileName';
import { parseOneCPushStatus } from '@/lib/documents/oneCPushStatus';
import { errorMessageRu } from '@/lib/errors/messages';
import { log } from '@/lib/logging';
import { safeText, styleHeader } from '@/lib/services/export/xlsx';
import { getObjectStorage } from '@/lib/storage';
import { writeSyncLog } from './log';
import {
  buildDocumentRecord,
  documentSelect,
  reissueChainRootId,
  type OneCDocumentRecord,
} from './pushDocument';
import { ONE_C_PUSHABLE_TYPES, isOneCPushableType, type OneCPushableType } from './schemas';
import { importScope } from './scope';

/**
 * Этап 8 (`У-173`): файловый канал выгрузки документов в 1С.
 *
 * Когда сетевой обмен не настроен (или 1С стоит за закрытым контуром),
 * бухгалтер забирает документы пакетом: один ZIP, внутри `documents.xlsx`
 * с листами «Документы» и «Строки» — колонки повторяют тело сетевой выгрузки
 * (контракт, секция 6) — и папка `files/` с самими PDF. Документы после
 * этого помечаются `exported_file` (`У-171`), пакет попадает в общую историю
 * обмена каналом «Документы → 1С» (`У-48`), в журнал аудита — одно событие
 * на пакет.
 *
 * Скоуп — как у импорта: администратор видит все компании, руководитель —
 * свою; рядовому менеджеру канала нет (`forbidden`).
 */

/** Больше документов в один пакет не кладём — предлагаем сузить фильтр (§15: молчаливое усечение — дефект). */
export const EXPORT_PACKAGE_LIMIT = 500;

export type ExportPackageFilter = {
  /** Дата выпуска — с этого дня (начало дня). */
  from?: Date | undefined;
  /** Дата выпуска — по этот день включительно (начало дня). */
  to?: Date | undefined;
  type?: OneCPushableType | undefined;
  oneCPushStatus?: OneCPushStatus | undefined;
};

/** Сырые значения из адресной строки (`?from=&to=&type=&oneCPushStatus=`). */
export type ExportPackageQuery = {
  from?: string | undefined;
  to?: string | undefined;
  type?: string | undefined;
  oneCPushStatus?: string | undefined;
};

/** `2026-09-04` → полночь UTC; всё остальное — «без даты». */
function parseDay(value: string | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Фильтр из адресной строки: чужое слово — не ошибка, а «без фильтра» (как `parseOneCPushStatus`). */
export function parseExportPackageFilter(q: ExportPackageQuery): ExportPackageFilter {
  return {
    from: parseDay(q.from),
    to: parseDay(q.to),
    type: q.type && isOneCPushableType(q.type) ? q.type : undefined,
    oneCPushStatus: parseOneCPushStatus(q.oneCPushStatus),
  };
}

/** Почему документ в пакет не попадёт — те же причины, что и у сетевой выгрузки. */
type ExportBlockReason = 'counterparty_without_inn' | 'no_number';

export type ExportCandidate = {
  id: string;
  type: OneCPushableType;
  number: string | null;
  name: string;
  createdAt: Date;
  version: number;
  counterpartyName: string | null;
  oneCPushStatus: OneCPushStatus;
  blocked: ExportBlockReason | null;
};

type ExportSkipped = {
  documentId: string;
  number: string | null;
  reason: ExportBlockReason | 'file_unavailable';
};

export type ExportCandidatesResult =
  | {
      ok: true;
      items: ExportCandidate[];
      /** Сколько из найденных реально войдёт в пакет. */
      ready: number;
      /** Нашлось больше лимита — показаны первые `EXPORT_PACKAGE_LIMIT`. */
      truncated: boolean;
    }
  | { ok: false; error: 'forbidden' };

export type ExportPackageResult =
  | { ok: true; zip: Buffer; fileName: string; count: number; skipped: ExportSkipped[] }
  | { ok: false; error: 'forbidden' | 'empty' };

const candidateSelect = {
  ...documentSelect,
  name: true,
  companyId: true,
} as const;

type CandidateRow = Prisma.DocumentGetPayload<{ select: typeof candidateSelect }>;

/** Границы дня считаются в UTC — так же, как их разобрал `parseDay`. */
function nextDay(d: Date): Date {
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() + 1);
  return n;
}

function scopeWhere(session: SessionPayload): Prisma.DocumentWhereInput | null {
  const scope = importScope(session);
  if (scope.kind === 'global') return {};
  if (scope.kind === 'company') return { companyId: scope.companyId };
  return null;
}

/**
 * Кандидаты: только выгружаемые типы (`Р-14`: КП — никогда), действующие
 * версии (`У-151`) и то, что родилось здесь — документ, пришедший ИЗ 1С
 * (`externalId`), обратно не возим. Берём на один больше лимита, чтобы честно
 * сказать «показаны не все».
 */
async function loadCandidates(
  prisma: PrismaClient,
  where: Prisma.DocumentWhereInput,
  filter: ExportPackageFilter
): Promise<{ rows: CandidateRow[]; truncated: boolean }> {
  const createdAt: Prisma.DateTimeFilter = {};
  if (filter.from) createdAt.gte = filter.from;
  if (filter.to) createdAt.lt = nextDay(filter.to);
  const rows = await prisma.document.findMany({
    where: {
      ...where,
      type: filter.type ?? { in: [...ONE_C_PUSHABLE_TYPES] },
      supersededAt: null,
      externalId: null,
      ...(filter.oneCPushStatus ? { oneCPushStatus: filter.oneCPushStatus } : {}),
      createdAt,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: EXPORT_PACKAGE_LIMIT + 1,
    select: candidateSelect,
  });
  return {
    rows: rows.slice(0, EXPORT_PACKAGE_LIMIT),
    truncated: rows.length > EXPORT_PACKAGE_LIMIT,
  };
}

/**
 * Контрагенты пачкой: два запроса на весь список вместо одного на документ.
 * Ключ — `type:id`, потому что контрагент полиморфный.
 */
async function loadCounterparties(
  prisma: PrismaClient,
  rows: CandidateRow[]
): Promise<Map<string, { name: string; inn: string | null }>> {
  const ids = (kind: 'organization' | 'partner') =>
    rows.flatMap((r) =>
      r.counterpartyType === kind && r.counterpartyId ? [r.counterpartyId] : []
    );
  const select = { id: true, name: true, inn: true } as const;
  const [orgs, partners] = await Promise.all([
    prisma.organization.findMany({ where: { id: { in: ids('organization') } }, select }),
    prisma.partner.findMany({ where: { id: { in: ids('partner') } }, select }),
  ]);
  const map = new Map<string, { name: string; inn: string | null }>();
  for (const o of orgs) map.set(`organization:${o.id}`, o);
  for (const p of partners) map.set(`partner:${p.id}`, p);
  return map;
}

/** Список для экрана: что войдёт в пакет и почему что-то не войдёт. */
export async function listExportCandidates(
  prisma: PrismaClient,
  session: SessionPayload,
  filter: ExportPackageFilter = {}
): Promise<ExportCandidatesResult> {
  const where = scopeWhere(session);
  if (!where) return { ok: false, error: 'forbidden' };

  const { rows, truncated } = await loadCandidates(prisma, where, filter);
  const counterparties = await loadCounterparties(prisma, rows);
  const items = rows.map((r): ExportCandidate => {
    const cp = counterparties.get(`${r.counterpartyType}:${r.counterpartyId}`) ?? null;
    // Порядок причин — тот же, что у сетевой выгрузки (`buildDocumentRecord`):
    // сначала ИНН, потом номер.
    const blocked: ExportBlockReason | null = !cp?.inn
      ? 'counterparty_without_inn'
      : !r.number
        ? 'no_number'
        : null;
    return {
      id: r.id,
      // `where` уже отобрал только выгружаемые типы — сужение без проверки.
      type: r.type as OneCPushableType,
      number: r.number,
      name: r.name,
      createdAt: r.createdAt,
      version: r.version,
      counterpartyName: cp?.name ?? null,
      oneCPushStatus: r.oneCPushStatus,
      blocked,
    };
  });
  return { ok: true, items, ready: items.filter((i) => !i.blocked).length, truncated };
}

type PackedDocument = { doc: CandidateRow; record: OneCDocumentRecord; file: string };

/**
 * Имя файла внутри архива — без повторов: «… (2).pdf», если такое уже есть.
 * Расширение у имени есть всегда: `documentDownloadName` его гарантирует.
 */
function uniqueName(base: string, used: Set<string>): string {
  const dot = base.lastIndexOf('.');
  let name = base;
  for (let i = 2; used.has(name); i += 1) {
    name = `${base.slice(0, dot)} (${i})${base.slice(dot)}`;
  }
  used.add(name);
  return name;
}

/** Лист «Документы» + «Строки» + «Не вошли»: заголовки — «по-русски (ключ контракта)». */
async function renderPackageXlsx(
  packed: PackedDocument[],
  skipped: ExportSkipped[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';

  const docs = wb.addWorksheet('Документы');
  docs.columns = [
    { header: 'Ключ (externalId)', key: 'externalId', width: 28 },
    { header: 'Тип (type)', key: 'type', width: 16 },
    { header: 'Номер (number)', key: 'number', width: 16 },
    { header: 'Дата (date)', key: 'date', width: 22 },
    { header: 'Версия (version)', key: 'version', width: 10 },
    { header: 'ИНН (counterparty.inn)', key: 'inn', width: 14 },
    { header: 'КПП (counterparty.kpp)', key: 'kpp', width: 12 },
    { header: 'Контрагент (counterparty.name)', key: 'cpName', width: 32 },
    { header: 'Юр. название (counterparty.legalName)', key: 'cpLegalName', width: 32 },
    { header: 'Заказ в 1С (order.externalId)', key: 'orderExternalId', width: 24 },
    { header: 'Номер заказа (order.orderNumber)', key: 'orderNumber', width: 18 },
    { header: 'Основание (parentDocument.externalId)', key: 'parentExternalId', width: 28 },
    { header: 'Номер основания (parentDocument.number)', key: 'parentNumber', width: 18 },
    { header: 'Без НДС (totals.net)', key: 'net', width: 14 },
    { header: 'НДС (totals.vat)', key: 'vat', width: 14 },
    { header: 'Итого (totals.gross)', key: 'gross', width: 14 },
    { header: 'Файл в архиве (file)', key: 'file', width: 40 },
  ];
  const lines = wb.addWorksheet('Строки');
  lines.columns = [
    { header: 'Ключ документа (externalId)', key: 'externalId', width: 28 },
    { header: 'Номер документа (number)', key: 'number', width: 16 },
    { header: 'Наименование (title)', key: 'title', width: 40 },
    { header: 'Количество (quantity)', key: 'quantity', width: 12 },
    { header: 'Ед. (unit)', key: 'unit', width: 8 },
    { header: 'Цена (price)', key: 'price', width: 14 },
    { header: 'Ставка НДС (vatRate)', key: 'vatRate', width: 12 },
    { header: 'НДС (vatAmount)', key: 'vatAmount', width: 14 },
    { header: 'Сумма (amount)', key: 'amount', width: 14 },
  ];
  let lineRows = 0;
  for (const { record: r, file } of packed) {
    docs.addRow({
      externalId: r.externalId,
      type: r.type,
      number: safeText(r.number),
      date: r.date,
      version: r.version,
      inn: r.counterparty.inn,
      kpp: r.counterparty.kpp ?? '',
      cpName: safeText(r.counterparty.name),
      cpLegalName: safeText(r.counterparty.legalName ?? ''),
      orderExternalId: r.order?.externalId ?? '',
      orderNumber: r.order?.orderNumber ?? '',
      parentExternalId: r.parentDocument?.externalId ?? '',
      parentNumber: safeText(r.parentDocument?.number ?? ''),
      net: r.totals?.net ?? '',
      vat: r.totals?.vat ?? '',
      gross: r.totals?.gross ?? '',
      file,
    });
    // Legacy-документы без строк (`lines: null`) — на листе «Строки» их нет.
    for (const l of r.lines ?? []) {
      lineRows += 1;
      lines.addRow({
        externalId: r.externalId,
        number: safeText(r.number),
        title: safeText(l.title),
        quantity: l.quantity,
        unit: l.unit,
        price: l.price,
        vatRate: l.vatRate ?? '',
        vatAmount: l.vatAmount,
        amount: l.amount,
      });
    }
  }
  styleHeader(docs, packed.length > 0);
  styleHeader(lines, lineRows > 0);

  const missed = wb.addWorksheet('Не вошли');
  missed.columns = [
    { header: 'Документ (id)', key: 'documentId', width: 28 },
    { header: 'Номер', key: 'number', width: 16 },
    { header: 'Почему', key: 'reason', width: 70 },
  ];
  for (const s of skipped) {
    missed.addRow({
      documentId: s.documentId,
      number: safeText(s.number ?? ''),
      reason: errorMessageRu(s.reason),
    });
  }
  styleHeader(missed, skipped.length > 0);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Отметка «уехал файлом» (`У-171`). Документ, который 1С уже приняла по сети
 * (`pushed`), не понижаем: файл для него — копия, а не новый канал. Версия
 * у документов разная, а `updateMany` одна на всех — группируем по версии.
 */
async function markExported(
  prisma: PrismaClient,
  packed: PackedDocument[],
  now: Date
): Promise<void> {
  const byVersion = new Map<number, string[]>();
  for (const { doc } of packed) {
    byVersion.set(doc.version, [...(byVersion.get(doc.version) ?? []), doc.id]);
  }
  for (const [version, ids] of byVersion) {
    await prisma.document.updateMany({
      where: { id: { in: ids }, oneCPushStatus: { not: 'pushed' } },
      data: {
        oneCPushStatus: 'exported_file',
        oneCPushedAt: now,
        oneCPushedVersion: version,
        oneCPushError: null,
      },
    });
  }
}

/** Собрать ZIP, отметить документы, записать в историю и журнал. */
export async function buildExportPackage(
  prisma: PrismaClient,
  session: SessionPayload,
  filter: ExportPackageFilter = {}
): Promise<ExportPackageResult> {
  const where = scopeWhere(session);
  if (!where) return { ok: false, error: 'forbidden' };
  const startedAt = Date.now();
  const { rows } = await loadCandidates(prisma, where, filter);

  const storage = getObjectStorage();
  const zip = new JSZip();
  const used = new Set<string>();
  const packed: PackedDocument[] = [];
  const skipped: ExportSkipped[] = [];
  for (const doc of rows) {
    const externalId = await reissueChainRootId(prisma, doc);
    const built = await buildDocumentRecord(prisma, doc, doc.type as OneCPushableType, externalId);
    if (!built.ok) {
      skipped.push({ documentId: doc.id, number: doc.number, reason: built.error });
      continue;
    }
    let content: Buffer;
    try {
      content = await storage.download(doc.path);
    } catch (err) {
      // Файла в хранилище нет — документ пропускаем, а не роняем весь пакет:
      // бухгалтер получит остальное, а этот увидит на листе «Не вошли».
      log.error('[buildExportPackage] file download failed', {
        documentId: doc.id,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped.push({ documentId: doc.id, number: doc.number, reason: 'file_unavailable' });
      continue;
    }
    const file = uniqueName(documentDownloadName(doc), used);
    zip.file(`files/${file}`, content);
    packed.push({ doc, record: built.record, file });
  }
  if (packed.length === 0) return { ok: false, error: 'empty' };

  zip.file('documents.xlsx', await renderPackageXlsx(packed, skipped));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  const now = new Date();
  await markExported(prisma, packed, now);

  const scope = importScope(session);
  const documentIds = packed.map((p) => p.doc.id);
  const { id: packageId } = await writeSyncLog(
    {
      entity: 'document',
      direction: 'outbound',
      operation: 'export',
      status: skipped.length ? 'warn' : 'success',
      payload: {
        companyId: scope.kind === 'company' ? scope.companyId : null,
        actorUserId: session.sub,
        actorName: session.name ?? null,
        documents: packed.length,
        skipped: skipped.length,
        skippedDocuments: skipped,
        filter: {
          from: filter.from?.toISOString() ?? null,
          to: filter.to?.toISOString() ?? null,
          type: filter.type ?? null,
          oneCPushStatus: filter.oneCPushStatus ?? null,
        },
        documentIds,
      },
      durationMs: Date.now() - startedAt,
    },
    prisma
  );
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'documents_exported_to_1c_file',
    entity: 'document',
    entityId: packageId,
    after: { documents: packed.length, skipped: skipped.length, documentIds },
  });

  const stamp = now.toISOString().slice(0, 10);
  return {
    ok: true,
    zip: buffer,
    fileName: `1c-documents-${stamp}.zip`,
    count: packed.length,
    skipped,
  };
}
