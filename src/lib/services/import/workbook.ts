import * as XLSX from 'xlsx';
import { loadXlsxWorkbook } from './load-xlsx';

/**
 * Загрузчик книги для импорта 1С (ТЗ починки импорта, Т-13/Т-14).
 *
 * Формат определяется ПО СОДЕРЖИМОМУ, а не по расширению: переименованный
 * `.xls` под именем `.xlsx` — самый частый случай у выгрузок 1С, и отказывать в
 * файле, который мы умеем читать, из-за имени было бы вредно (решение спеки
 * §4.4, подтверждено с этапом 3).
 *
 * Оба пути отдают одну форму — «имя листа + сетка значений», где `rows[0]` —
 * шапка. Типы значений согласованы: числа приходят числами, даты — `Date`
 * (ExcelJS делает так сам, для SheetJS это `cellDates: true` + `raw: true`).
 *
 * Это НЕ замена `oneCAccountCard/read-spreadsheet.ts`: тот читает только первый
 * лист и отдаёт строки текстом — у банковской выписки свой контракт, и Т-13
 * реализован общим загрузчиком, а не переиспользованием (спека §4.3).
 */

export type SheetGrid = { name: string; rows: unknown[][] };

export type WorkbookFormat = 'xlsx' | 'xls';

/** Содержимое не является книгой Excel (ни zip/xlsx, ни OLE/xls). */
export class WorkbookFormatError extends Error {
  constructor() {
    super('buffer is neither xlsx nor xls');
    this.name = 'WorkbookFormatError';
  }
}

/** Формат по первым байтам: `PK` → xlsx (zip), `D0 CF 11 E0` → xls (OLE). */
export function sniffWorkbookFormat(buffer: Buffer): WorkbookFormat | null {
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) return 'xlsx';
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  )
    return 'xls';
  return null;
}

async function loadXlsxGrids(buffer: Buffer): Promise<SheetGrid[]> {
  const wb = await loadXlsxWorkbook(buffer);
  return wb.worksheets.map((ws) => {
    const rows: unknown[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: unknown[] = [];
      const width = Math.max(ws.columnCount, row.cellCount);
      for (let c = 1; c <= width; c++) {
        cells.push(row.getCell(c).value ?? null);
      }
      rows.push(cells);
    }
    return { name: ws.name, rows };
  });
}

function loadXlsGrids(buffer: Buffer): SheetGrid[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    /* v8 ignore next -- SheetNames всегда указывают на существующий лист; страховка от битой книги */
    if (!ws) return { name, rows: [] };
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
    return { name, rows: rows as unknown[][] };
  });
}

/** Книга любого поддерживаемого формата → листы с сетками значений. */
export async function loadWorkbookSheets(buffer: Buffer | ArrayBuffer): Promise<SheetGrid[]> {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const format = sniffWorkbookFormat(buf);
  if (format === null) throw new WorkbookFormatError();
  return format === 'xlsx' ? loadXlsxGrids(buf) : loadXlsGrids(buf);
}
