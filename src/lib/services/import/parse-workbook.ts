import type ExcelJS from 'exceljs';
import { SHEET_NAMES, ORG_COLS, ORDER_COLS, PAYMENT_COLS } from './column-map';
import { loadXlsxWorkbook } from './load-xlsx';
import { unmatchedHeadersOf, type ImportDiagnostics } from './diagnostics';

/**
 * Normalise an ExcelJS cell value to a plain string for header matching.
 * exceljs can return rich-text objects ({ richText: [...] }), formula results
 * ({ result: ..., formula: ... }), or plain strings/numbers — handle all cases.
 */
export function cellToString(value: ExcelJS.CellValue): string {
  // ExcelJS serialises empty cells as null; undefined is unreachable via parseWorkbook(buffer) round-trip.
  /* v8 ignore next -- undefined arm of || is unreachable through xlsx serialisation */
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
 * Строки листа плюс диагностика его шапки (Т-3). Лист, которого нет в книге,
 * отдаёт пустые строки и `found: false` — раньше это молчание было главной
 * причиной непонятного «Файл пуст».
 */
function readSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  cols: Record<string, string>
): { found: boolean; name: string; rows: unknown[]; unmatchedHeaders: string[] } {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return { found: false, name: sheetName, rows: [], unmatchedHeaders: [] };
  const header = ws.getRow(1);
  const colIndex = new Map<string, number>();
  const headerLabels: string[] = [];
  header.eachCell((cell, col) => {
    const label = cellToString(cell.value);
    colIndex.set(label, col);
    headerLabels.push(label);
  });
  const fieldToCol = Object.entries(cols).map(
    ([field, label]) => [field, colIndex.get(label)] as const
  );

  const rows: unknown[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.cellCount === 0) continue;
    const obj: Record<string, unknown> = {};
    for (const [field, col] of fieldToCol) {
      if (col === undefined) continue;
      const v = row.getCell(col).value;
      obj[field] = v === null || v === undefined ? null : v;
    }
    rows.push(obj);
  }
  return {
    found: true,
    name: ws.name,
    rows,
    unmatchedHeaders: unmatchedHeadersOf(headerLabels, cols),
  };
}

export type ParsedWorkbook = {
  orgs: unknown[];
  orders: unknown[];
  payments: unknown[];
  diagnostics: ImportDiagnostics;
};

export async function parseWorkbook(buffer: Buffer | ArrayBuffer): Promise<ParsedWorkbook> {
  const wb = await loadXlsxWorkbook(buffer);
  const orgs = readSheet(wb, SHEET_NAMES.orgs, ORG_COLS);
  const orders = readSheet(wb, SHEET_NAMES.orders, ORDER_COLS);
  const payments = readSheet(wb, SHEET_NAMES.payments, PAYMENT_COLS);

  const unmatchedHeaders: Record<string, string[]> = {};
  for (const sheet of [orgs, orders, payments]) {
    if (sheet.found) unmatchedHeaders[sheet.name] = sheet.unmatchedHeaders;
  }

  return {
    orgs: orgs.rows,
    orders: orders.rows,
    payments: payments.rows,
    diagnostics: {
      sheetsFound: wb.worksheets.map((ws) => ws.name),
      sheetsExpected: Object.values(SHEET_NAMES),
      unmatchedHeaders,
    },
  };
}
