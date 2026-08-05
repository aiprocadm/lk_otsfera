import type ExcelJS from 'exceljs';
import { SHEET_NAMES, ORG_COLS, ORDER_COLS, PAYMENT_COLS, REQUIRED_COLS } from './column-map';
import { loadWorkbookSheets, type SheetGrid } from './workbook';
import { normalizeLabel } from './normalize';
import { unmatchedHeadersOf, type ImportDiagnostics } from './diagnostics';

/**
 * Normalise a workbook cell value to a plain string for header matching.
 * ExcelJS can return rich-text objects ({ richText: [...] }), formula results
 * ({ result: ..., formula: ... }), or plain strings/numbers — handle all cases.
 * (SheetJS-путь `.xls` отдаёт примитивы — они покрыты теми же ветками.)
 */
export function cellToString(value: ExcelJS.CellValue): string {
  // Пустые ячейки сетка отдаёт как null; undefined недостижим через loadWorkbookSheets.
  /* v8 ignore next -- undefined arm of || is unreachable through the grid round-trip */
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  // Rich-text object
  if (
    typeof value === 'object' &&
    'richText' in value &&
    Array.isArray((value as { richText: unknown[] }).richText)
  ) {
    return (
      (value as { richText: Array<{ text?: string }> }).richText
        /* v8 ignore next -- RichText.text is always string per ExcelJS types; ?? '' is an unreachable defensive fallback */
        .map((r) => r.text ?? '')
        .join('')
        .trim()
    );
  }
  // Formula result
  if (typeof value === 'object' && 'result' in value) {
    const result = (value as { result: ExcelJS.CellValue }).result;
    return cellToString(result);
  }
  return String(value).trim();
}

/**
 * Лист подходит под вид, если нормализованные имена входят друг в друга в ЛЮБУЮ
 * сторону (Т-10): алиас «Реализация» находит лист «Реализация товаров и услуг»,
 * а лист «Контрагент» находится по алиасу «Контрагенты».
 */
function sheetMatches(sheetName: string, aliases: readonly string[]): boolean {
  const name = normalizeLabel(sheetName);
  /* v8 ignore next -- пустое имя листа не создаётся ни ExcelJS, ни SheetJS; страховка от вхождения '' в любой алиас */
  if (!name) return false;
  return aliases.some((alias) => {
    const a = normalizeLabel(alias);
    return name.includes(a) || a.includes(name);
  });
}

type ReadResult = {
  rows: unknown[];
  unmatchedHeaders: string[];
  missing: string[];
};

/**
 * Строки листа плюс диагностика его шапки. Колонка ищется по алиасам (Т-9):
 * первый совпавший — победитель. `missing` — основные ярлыки обязательных
 * колонок, которых в шапке не нашлось (Т-12).
 */
function readGrid(
  grid: SheetGrid,
  cols: Record<string, readonly string[]>,
  required: readonly string[]
): ReadResult {
  const headerRow = grid.rows[0] ?? [];
  const colIndex = new Map<string, number>();
  const headerLabels: string[] = [];
  headerRow.forEach((cell, idx) => {
    const label = cellToString(cell as ExcelJS.CellValue);
    headerLabels.push(label);
    const key = normalizeLabel(label);
    if (key && !colIndex.has(key)) colIndex.set(key, idx);
  });

  const fieldToCol = Object.entries(cols).map(([field, aliases]) => {
    for (const alias of aliases) {
      const idx = colIndex.get(normalizeLabel(alias));
      if (idx !== undefined) return [field, idx] as const;
    }
    return [field, undefined] as const;
  });

  const rows: unknown[] = [];
  for (const row of grid.rows.slice(1)) {
    if (row.every((v) => v === null || v === undefined || v === '')) continue;
    const obj: Record<string, unknown> = {};
    for (const [field, col] of fieldToCol) {
      if (col === undefined) continue;
      const v = row[col];
      obj[field] = v === null || v === undefined ? null : v;
    }
    rows.push(obj);
  }

  const missingFields = new Set(
    fieldToCol.filter(([, col]) => col === undefined).map(([field]) => field)
  );
  return {
    rows,
    unmatchedHeaders: unmatchedHeadersOf(headerLabels, cols),
    // Основной ярлык — первый алиас поля; массивы алиасов непусты по построению карты.
    missing: required.filter((f) => missingFields.has(f)).map((f) => cols[f]![0]!),
  };
}

export type ParsedWorkbook = {
  orgs: unknown[];
  orders: unknown[];
  payments: unknown[];
  diagnostics: ImportDiagnostics;
};

export async function parseWorkbook(buffer: Buffer | ArrayBuffer): Promise<ParsedWorkbook> {
  const sheets = await loadWorkbookSheets(buffer);

  const unmatchedHeaders: Record<string, string[]> = {};
  const missingColumns: Record<string, string[]> = {};
  const duplicateSheets: Record<string, string[]> = {};

  const readKind = (
    kind: keyof typeof SHEET_NAMES,
    cols: Record<string, readonly string[]>
  ): unknown[] => {
    const aliases = SHEET_NAMES[kind];
    const matches = sheets.filter((s) => sheetMatches(s.name, aliases));
    const primary = matches[0];
    if (!primary) return [];
    if (matches.length > 1) {
      // Первый в порядке книги — победитель; остальные показываем (спека §4.2).
      duplicateSheets[aliases[0]] = matches.slice(1).map((s) => s.name);
    }
    const result = readGrid(primary, cols, REQUIRED_COLS[kind]);
    unmatchedHeaders[primary.name] = result.unmatchedHeaders;
    if (result.missing.length > 0) missingColumns[primary.name] = result.missing;
    return result.rows;
  };

  const orgs = readKind('orgs', ORG_COLS);
  const orders = readKind('orders', ORDER_COLS);
  const payments = readKind('payments', PAYMENT_COLS);

  return {
    orgs,
    orders,
    payments,
    diagnostics: {
      sheetsFound: sheets.map((s) => s.name),
      sheetsExpected: Object.values(SHEET_NAMES).map((aliases) => aliases[0]),
      unmatchedHeaders,
      missingColumns,
      duplicateSheets,
    },
  };
}
