import type ExcelJS from 'exceljs';
import type { CatalogUnit, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { loadXlsxWorkbook } from '@/lib/services/import/load-xlsx';
import { cellToString } from '@/lib/services/import/parse-workbook';
import { recordAudit } from '@/lib/auth/audit';
import {
  CATALOG_UNIT_LABELS,
  VAT_RATES,
  validateCatalogItemInput,
  type CatalogItemInput,
  type CatalogItemRow,
} from './catalogItems';

/**
 * Excel-импорт и экспорт каталога услуг (`У-137`, этап 5 PR-2).
 *
 * Импорт в два шага по эталону импорта сотрудников: **предпросмотр ничего не
 * пишет**, подтверждение коммитит ровно показанные строки одной транзакцией.
 * Сопоставление — по артикулу (`code`): найден в каталоге компании →
 * обновление, нет → создание. Правила полей — те же, что у формы
 * (`validateCatalogItemInput`): файл не может провезти то, что нельзя ввести
 * руками.
 */

/** Колонки: одна константа для шаблона, парсера и экспорта. */
export const CATALOG_IMPORT_COLUMNS = {
  name: 'Название',
  code: 'Артикул',
  unit: 'Единица',
  price: 'Цена',
  vatRate: 'Ставка НДС',
  vatIncluded: 'Цена включает НДС',
  direction: 'Направление',
  description: 'Описание',
  sortOrder: 'Порядок',
} as const;

export type CatalogImportRow = {
  /** Номер строки файла — ошибки указывают на конкретную строку. */
  line: number;
  input: CatalogItemInput;
};

export type CatalogImportPreview = {
  toCreate: CatalogImportRow[];
  toUpdate: Array<{ row: CatalogImportRow; existingId: string }>;
  errors: string[];
};

function normalizeHeader(text: string): string {
  return text.replace(/\*/g, '').trim().toLowerCase();
}

/**
 * Обратная сторона `safeText`: экспорт экранирует ведущие `= + - @`
 * апострофом — при импорте выгрузки его надо снять, иначе артикул «-А1»
 * вернётся как «'-А1» и создаст дубль вместо обновления.
 */
function unescapeSafeText(text: string): string {
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

/** Обратный словарь единиц: русская подпись (или код) → значение enum. */
function parseUnit(text: string): CatalogUnit | undefined | null {
  const t = text.trim().toLowerCase().replace(/\.$/, '');
  if (!t) return null; // пусто — возьмём умолчание person
  for (const [unit, label] of Object.entries(CATALOG_UNIT_LABELS)) {
    if (label.replace(/\.$/, '') === t || unit === t) return unit as CatalogUnit;
  }
  return undefined;
}

/** «20%», «20», «0.2» → '0.2'; «не облагается»/«нет»/«усн»/пусто → null. */
function parseVatRate(text: string): string | null | undefined {
  const t = text.trim().toLowerCase().replace(',', '.');
  if (!t || t === 'не облагается' || t === 'нет' || t === 'усн' || t === '—' || t === '-') {
    return null;
  }
  const num = Number(t.replace('%', ''));
  if (!Number.isFinite(num)) return undefined;
  // И проценты («20»), и доли («0.2») — файл заполняют по-разному.
  const rate = num >= 1 ? num / 100 : num;
  return VAT_RATES.includes(rate as (typeof VAT_RATES)[number]) ? String(rate) : undefined;
}

function parseBool(text: string): boolean | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return true; // умолчание модели — цена включает НДС
  if (['да', '1', 'true', 'включает'].includes(t)) return true;
  if (['нет', '0', 'false', 'сверх'].includes(t)) return false;
  return undefined;
}

/**
 * Разбор файла. `directions` — справочник направлений для сопоставления по
 * ИМЕНИ: неизвестное направление — построчная ошибка, а не молчаливый null
 * (по связи работает «Собрать строки из позиций», `У-139`).
 */
export async function parseCatalogWorkbook(
  buffer: Buffer | ArrayBuffer,
  directions: Array<{ id: string; name: string }>
): Promise<
  { ok: true; rows: CatalogImportRow[]; errors: string[] } | { ok: false; errors: string[] }
> {
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadXlsxWorkbook(buffer);
  } catch {
    return {
      ok: false,
      errors: ['Не удалось прочитать файл — ожидается Excel (.xlsx). Скачайте шаблон.'],
    };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, errors: ['В файле нет ни одного листа. Скачайте шаблон.'] };

  const index = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => index.set(normalizeHeader(cellToString(cell.value)), col));
  const col = (key: keyof typeof CATALOG_IMPORT_COLUMNS): number | undefined =>
    index.get(normalizeHeader(CATALOG_IMPORT_COLUMNS[key]));

  if (!col('name') || !col('code') || !col('price')) {
    return {
      ok: false,
      errors: [
        'В первой строке файла нет колонок «Название», «Артикул» и «Цена». ' +
          'Скачайте шаблон и заполните его.',
      ],
    };
  }

  const byName = new Map(directions.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const rows: CatalogImportRow[] = [];
  const errors: string[] = [];

  for (let line = 2; line <= ws.rowCount; line++) {
    const r = ws.getRow(line);
    const text = (key: keyof typeof CATALOG_IMPORT_COLUMNS): string => {
      const c = col(key);
      return c ? unescapeSafeText(cellToString(r.getCell(c).value).trim()) : '';
    };

    const name = text('name');
    const code = text('code');
    const price = text('price');
    // Пустой хвост файла — не ошибка.
    if (!name && !code && !price) continue;

    const unit = parseUnit(text('unit'));
    if (unit === undefined) {
      errors.push(
        `Строка ${line}: единица «${text('unit')}» не распознана — ` +
          `допустимы: ${Object.values(CATALOG_UNIT_LABELS).join(', ')}.`
      );
      continue;
    }
    const vatRate = parseVatRate(text('vatRate'));
    if (vatRate === undefined) {
      errors.push(
        `Строка ${line}: ставка НДС «${text('vatRate')}» не распознана — ` +
          'допустимы 0%, 5%, 7%, 10%, 20% или «не облагается».'
      );
      continue;
    }
    const vatIncluded = parseBool(text('vatIncluded'));
    if (vatIncluded === undefined) {
      errors.push(`Строка ${line}: «${text('vatIncluded')}» — укажите «да» или «нет».`);
      continue;
    }
    const directionText = text('direction');
    const directionId = directionText ? byName.get(directionText.toLowerCase()) : null;
    if (directionText && !directionId) {
      errors.push(
        `Строка ${line}: направление «${directionText}» не найдено в справочнике — ` +
          'проверьте название или оставьте колонку пустой.'
      );
      continue;
    }
    const sortText = text('sortOrder');
    const sortOrder = sortText ? Number(sortText) : 0;

    const input: CatalogItemInput = {
      name,
      code,
      unit: unit ?? 'person',
      price,
      vatRate,
      vatIncluded,
      directionId: directionId ?? null,
      description: text('description') || null,
      sortOrder,
    };
    const validated = validateCatalogItemInput(input);
    if (!validated.ok) {
      errors.push(`Строка ${line}: ${validated.messages.join('; ')}.`);
      continue;
    }
    rows.push({ line, input });
  }

  return { ok: true, rows, errors };
}

type Forbidden = { ok: false; error: 'forbidden' };

/** Шаг 1: считаем «будет создано / обновлено / ошибок». Ничего не пишем. */
export async function previewCatalogImport(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { companyId: string; rows: CatalogImportRow[] }
): Promise<{ ok: true; preview: CatalogImportPreview } | Forbidden> {
  if (session.role !== 'admin' && session.role !== 'leader') {
    return { ok: false, error: 'forbidden' };
  }
  if (session.role === 'leader' && args.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }

  const existing = await prisma.catalogItem.findMany({
    where: { companyId: args.companyId },
    select: { id: true, code: true },
  });
  const byCode = new Map(existing.map((i) => [i.code, i.id]));

  const preview: CatalogImportPreview = { toCreate: [], toUpdate: [], errors: [] };
  const seenInFile = new Set<string>();
  for (const row of args.rows) {
    const code = row.input.code.trim();
    if (seenInFile.has(code)) {
      preview.errors.push(
        `Строка ${row.line}: артикул «${code}» уже встречался выше в этом файле — ` +
          'оставьте одну строку на артикул.'
      );
      continue;
    }
    seenInFile.add(code);
    const existingId = byCode.get(code);
    if (existingId) preview.toUpdate.push({ row, existingId });
    else preview.toCreate.push(row);
  }
  return { ok: true, preview };
}

/** Шаг 2: пишем ровно то, что показал предпросмотр, — одной транзакцией. */
export async function importCatalogItems(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { companyId: string; rows: CatalogImportRow[] }
): Promise<{ ok: true; created: number; updated: number } | Forbidden> {
  const pre = await previewCatalogImport(prisma, session, args);
  if (!pre.ok) return pre;
  const { toCreate, toUpdate } = pre.preview;

  const data = (row: CatalogImportRow) => {
    const v = validateCatalogItemInput(row.input);
    // Строки уже проходили валидацию при разборе; повторная — защита от
    // подделанного шага 2 (клиент возвращает строки сам).
    if (!v.ok) throw new Error(`Строка ${row.line}: ${v.messages.join('; ')}`);
    const d = v.data;
    return {
      name: d.name,
      code: d.code,
      unit: d.unit,
      price: d.price,
      vatRate: d.vatRate,
      vatIncluded: d.vatIncluded,
      directionId: d.directionId,
      description: d.description,
      sortOrder: d.sortOrder,
    };
  };

  // История цены (`У-136`) не обходится импортом: до записи снимаем «как
  // было» у обновляемых позиций — после транзакции каждая получит своё
  // `catalog_item_updated` с before/after, как при ручной правке.
  const beforeRows =
    toUpdate.length > 0
      ? await prisma.catalogItem.findMany({
          where: { id: { in: toUpdate.map((u) => u.existingId) } },
          select: { id: true, name: true, code: true, price: true, vatRate: true, vatIncluded: true, unit: true },
        })
      : [];
  const beforeById = new Map(beforeRows.map((b) => [b.id, b]));

  if (toCreate.length + toUpdate.length > 0) {
    await prisma.$transaction([
      ...toCreate.map((row) =>
        prisma.catalogItem.create({ data: { companyId: args.companyId, ...data(row) } })
      ),
      ...toUpdate.map(({ row, existingId }) =>
        prisma.catalogItem.update({ where: { id: existingId }, data: data(row) })
      ),
    ]);
  }

  for (const { row, existingId } of toUpdate) {
    const b = beforeById.get(existingId);
    if (!b) continue;
    const d = data(row);
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'catalog_item_updated',
      entity: 'catalog_item',
      entityId: existingId,
      before: {
        name: b.name,
        article: b.code,
        price: b.price.toFixed(2),
        vatRate: b.vatRate === null ? null : b.vatRate.toFixed(4),
        vatIncluded: b.vatIncluded,
        unit: b.unit,
      },
      after: {
        name: d.name,
        article: d.code,
        price: d.price,
        vatRate: d.vatRate,
        vatIncluded: d.vatIncluded,
        unit: d.unit,
      },
    });
  }

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'catalog_imported',
    entity: 'company',
    entityId: args.companyId,
    after: { created: toCreate.length, updated: toUpdate.length },
  });

  return { ok: true, created: toCreate.length, updated: toUpdate.length };
}

/** Ячейки экспорта — в формате, который парсер импорта понимает обратно. */
export function catalogExportCells(row: CatalogItemRow): {
  name: string;
  code: string;
  unit: string;
  price: string;
  vatRate: string;
  vatIncluded: string;
  direction: string;
  description: string;
  sortOrder: number;
  isActive: string;
} {
  return {
    name: row.name,
    code: row.code,
    unit: CATALOG_UNIT_LABELS[row.unit],
    price: row.price,
    vatRate: row.vatRate === null ? 'не облагается' : `${Math.round(Number(row.vatRate) * 100)}%`,
    vatIncluded: row.vatIncluded ? 'да' : 'нет',
    direction: row.directionName ?? '',
    description: row.description ?? '',
    sortOrder: row.sortOrder,
    isActive: row.isActive ? 'да' : 'нет',
  };
}
