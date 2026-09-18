import * as XLSX from 'xlsx';
import { loadXlsxWorkbook } from '../load-xlsx';
import { sniffWorkbookFormat } from '../workbook';

export type SpreadsheetFormat = 'xls' | 'xlsx';

/** Формат по расширению; неизвестное → xlsx (наиболее частый целевой). */
export function sniffFormat(fileName: string): SpreadsheetFormat {
  return /\.xls$/i.test(fileName) ? 'xls' : 'xlsx';
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (v instanceof Date) {
    const dd = String(v.getUTCDate()).padStart(2, '0');
    const mm = String(v.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${v.getUTCFullYear()}`;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText))
      return (o.richText as Array<{ text?: string }>)
        .map((r) => r.text ?? '')
        .join('')
        .trim();
    if ('result' in o) return cellToString(o.result);
    if ('text' in o) return cellToString(o.text);
  }
  return String(v).trim();
}

async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = await loadXlsxWorkbook(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const grid: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= Math.max(ws.columnCount, 12); c++)
      cells.push(cellToString(row.getCell(c).value));
    grid.push(cells);
  }
  return grid;
}

function readXls(buffer: Buffer): string[][] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const ws = sheetName === undefined ? undefined : wb.Sheets[sheetName];
  if (!ws) return [];
  // header:1 → массив массивов; defval:'' → не пропускать пустые ячейки (стабильные индексы).
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
  return rows.map((row) => (row as unknown[]).map(cellToString));
}

/**
 * Файл (любой поддерживаемый формат) → строки×колонки строк.
 *
 * **Формат определяется по содержимому, а не по имени** (`У-267`). Раньше
 * решало расширение, и это был дефект: старый `.xls`, сохранённый или
 * присланный под именем `.xlsx`, уезжал в ExcelJS, который двоичный формат не
 * читает вовсе, — человек получал техническую ошибку вместо своих строк.
 * Загрузчик выписки (`workbook.ts`) научили этому ещё в программе починки
 * импорта 1С (Т-13/Т-14), а карточку контрагента — нет; два читателя одних и
 * тех же выгрузок вели себя по-разному.
 *
 * Имя файла остаётся запасным вариантом: если по первым байтам формат не
 * опознан, поведение ровно прежнее — ошибку выдаст сам читатель, и текст её не
 * изменится.
 */
export async function readSpreadsheet(buffer: Buffer, fileName: string): Promise<string[][]> {
  const format = sniffWorkbookFormat(buffer) ?? sniffFormat(fileName);
  return format === 'xls' ? readXls(buffer) : readXlsx(buffer);
}
