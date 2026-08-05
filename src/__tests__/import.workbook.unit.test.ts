import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import {
  loadWorkbookSheets,
  sniffWorkbookFormat,
  WorkbookFormatError,
} from '@/lib/services/import/workbook';

/**
 * Т-13/Т-14: загрузчик книги по СОДЕРЖИМОМУ. Оба формата дают одинаковую форму
 * (имя листа + сетка значений), мусор — внятный отказ, а не исключение ExcelJS.
 */

async function xlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Контрагенты');
  ws.addRow(['Наименование', 'ИНН']);
  ws.addRow(['ООО Ромашка', '7700000001']);
  ws.addRow(['ООО Лютик', 7700000002]);
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

function xlsBuffer(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Наименование', 'ИНН'],
    ['ООО Ромашка', '7700000001'],
    ['ООО Лютик', 7700000002],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Контрагенты');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xls' }) as Buffer;
}

describe('sniffWorkbookFormat', () => {
  it('распознаёт форматы по первым байтам, а не по имени', async () => {
    expect(sniffWorkbookFormat(await xlsxBuffer())).toBe('xlsx');
    expect(sniffWorkbookFormat(xlsBuffer())).toBe('xls');
    expect(sniffWorkbookFormat(Buffer.from('%PDF-1.7 мусор'))).toBeNull();
    expect(sniffWorkbookFormat(Buffer.alloc(0))).toBeNull();
  });
});

describe('loadWorkbookSheets', () => {
  it('xlsx: имя листа и сетка с шапкой в первой строке', async () => {
    const sheets = await loadWorkbookSheets(await xlsxBuffer());
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('Контрагенты');
    expect(sheets[0].rows[0]).toEqual(['Наименование', 'ИНН']);
    expect(sheets[0].rows[1]).toEqual(['ООО Ромашка', '7700000001']);
    // Числа приходят числами — на этом держится разбор сумм.
    expect(sheets[0].rows[2]?.[1]).toBe(7700000002);
  });

  it('xls даёт ту же форму, что и xlsx (Т-13)', async () => {
    const sheets = await loadWorkbookSheets(xlsBuffer());
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('Контрагенты');
    expect(sheets[0].rows[0]).toEqual(['Наименование', 'ИНН']);
    expect(sheets[0].rows[2]?.[1]).toBe(7700000002);
  });

  it('содержимое не Excel → WorkbookFormatError (Т-14)', async () => {
    await expect(loadWorkbookSheets(Buffer.from('это просто текст'))).rejects.toBeInstanceOf(
      WorkbookFormatError
    );
  });

  it('принимает ArrayBuffer так же, как Buffer', async () => {
    const buf = await xlsxBuffer();
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    const sheets = await loadWorkbookSheets(ab);
    expect(sheets[0]?.name).toBe('Контрагенты');
  });
});
