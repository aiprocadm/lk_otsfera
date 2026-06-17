import ExcelJS from 'exceljs';
import { SHEET_NAMES, ORG_COLS, ORDER_COLS, PAYMENT_COLS } from './column-map';

/**
 * Normalise an ExcelJS cell value to a plain string for header matching.
 * exceljs can return rich-text objects ({ richText: [...] }), formula results
 * ({ result: ..., formula: ... }), or plain strings/numbers — handle all cases.
 */
function cellToString(value: ExcelJS.CellValue): string {
  // ExcelJS serialises empty cells as null; undefined is unreachable via parseWorkbook(buffer) round-trip.
  /* v8 ignore next -- undefined arm of || is unreachable through xlsx serialisation */
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  // Rich-text object
  if (typeof value === 'object' && 'richText' in value && Array.isArray((value as { richText: unknown[] }).richText)) {
    return (value as { richText: Array<{ text?: string }> }).richText
      /* v8 ignore next -- RichText.text is always string per ExcelJS types; ?? '' is an unreachable defensive fallback */
      .map((r) => r.text ?? '')
      .join('')
      .trim();
  }
  // Formula result
  if (typeof value === 'object' && 'result' in value) {
    const result = (value as { result: ExcelJS.CellValue }).result;
    return cellToString(result);
  }
  return String(value).trim();
}

function readSheet(wb: ExcelJS.Workbook, sheetName: string, cols: Record<string, string>): unknown[] {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return [];
  const header = ws.getRow(1);
  const colIndex = new Map<string, number>();
  header.eachCell((cell, col) => colIndex.set(cellToString(cell.value), col));
  const fieldToCol = Object.entries(cols).map(([field, label]) => [field, colIndex.get(label)] as const);

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
  return rows;
}

export async function parseWorkbook(buffer: Buffer | ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);
  return {
    orgs: readSheet(wb, SHEET_NAMES.orgs, ORG_COLS),
    orders: readSheet(wb, SHEET_NAMES.orders, ORDER_COLS),
    payments: readSheet(wb, SHEET_NAMES.payments, PAYMENT_COLS),
  };
}
