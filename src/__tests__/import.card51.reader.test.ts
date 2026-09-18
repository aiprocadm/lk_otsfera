import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import {
  sniffFormat,
  readSpreadsheet,
} from '@/lib/services/import/oneCAccountCard/read-spreadsheet';

describe('sniffFormat', () => {
  it('detects xlsx by extension', () => {
    expect(sniffFormat('a.XLSX')).toBe('xlsx');
  });
  it('detects xls by extension', () => {
    expect(sniffFormat('a.xls')).toBe('xls');
  });
  it('falls back to xlsx for unknown', () => {
    expect(sniffFormat('a.bin')).toBe('xlsx');
  });
});

async function xlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.addRow(['Сальдо на начало']);
  ws.addRow(['01.06.2026', 'Поступление 0000-001 от ...', '', 'ОРГ ООО', '', '14800', '', '62.01']);
  ws.addRow(['Обороты за период']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function xlsBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Сальдо на начало'],
    ['01.06.2026', 'Поступление 0000-001 от ...', '', 'ОРГ ООО', '', '14800', '', '62.01'],
    ['Обороты за период'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Лист1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xls' }) as Buffer;
}

describe('readSpreadsheet', () => {
  it('reads xlsx into string[][]', async () => {
    const grid = await readSpreadsheet(await xlsxBuffer(), 'card.xlsx');
    expect(grid[0][0]).toMatch(/Сальдо на начало/);
    expect(grid[1][1]).toMatch(/Поступление/);
  });

  it('reads xls into string[][]', async () => {
    const grid = await readSpreadsheet(xlsBuffer(), 'card.xls');
    expect(grid[0][0]).toMatch(/Сальдо на начало/);
    expect(grid[1][7]).toBe('62.01');
  });

  /**
   * `У-267`: формат берётся из содержимого, а не из имени.
   *
   * Это был дефект. Старый `.xls`, присланный под именем `.xlsx` (у выгрузок
   * 1С — обычное дело), уходил в ExcelJS, который двоичный формат не читает, и
   * человек получал техническую ошибку вместо своих строк. Загрузчик выписки
   * умел это с программы починки импорта, а карточка контрагента — нет.
   */
  it('старый .xls под именем .xlsx всё равно читается (У-267)', async () => {
    const grid = await readSpreadsheet(xlsBuffer(), 'выгрузка-из-1С.xlsx');
    expect(grid[0][0]).toMatch(/Сальдо на начало/);
    expect(grid[1][7]).toBe('62.01');
  });

  it('настоящий .xlsx под именем .xls тоже читается', async () => {
    const grid = await readSpreadsheet(await xlsxBuffer(), 'выгрузка-из-1С.xls');
    expect(grid[0][0]).toMatch(/Сальдо на начало/);
    expect(grid[1][1]).toMatch(/Поступление/);
  });

  it('когда формат по содержимому не опознан, решает имя — поведение прежнее', async () => {
    // Ни PK (zip), ни OLE2: `sniffWorkbookFormat` вернёт null, и выбор падает
    // на расширение. Ошибку выдаст сам читатель — текст её не изменился.
    await expect(readSpreadsheet(Buffer.from('%PDF-1.7 не книга'), 'card.xlsx')).rejects.toThrow();
  });
});
