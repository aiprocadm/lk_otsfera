import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseEnrollmentImportWorkbook } from '@/lib/services/enrollments/importRows';
import { cellToString } from '@/lib/services/import/parse-workbook';

/**
 * `У-326` / `Д-60` (ТЗ 28.10.2026): «ошибка на почте @yandex.ru».
 *
 * Дело не в Яндексе. Набранный в Excel адрес почты Excel сам превращает в
 * ссылку, и ячейка хранит уже не строку, а `{ text, hyperlink }` — а то и
 * `{ text: { richText: [...] }, hyperlink }`, если часть адреса выделена.
 * Разбор ячеек такого вида не знал, отдавал «[object Object]», и импорт
 * отказывал «некорректный email» на ЛЮБОМ адресе, введённом вручную.
 */

async function buildXlsx(emailCells: ExcelJS.CellValue[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Слушатели');
  ws.addRow(['ФИО', 'Email']);
  emailCells.forEach((email, i) => {
    const row = ws.addRow([`Слушатель ${i + 1}`, null]);
    row.getCell(2).value = email;
  });
  // Круг через файл: проверяем то, что ExcelJS прочитает с диска, а не объект в памяти.
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('Импорт заявки: адрес почты из ячейки-ссылки (У-326, Д-60)', () => {
  it('адрес-ссылка, как его сохраняет Excel, принимается', async () => {
    const buf = await buildXlsx([
      { text: 'Ivan.Petrov@yandex.ru', hyperlink: 'mailto:Ivan.Petrov@yandex.ru' },
    ]);
    const r = await parseEnrollmentImportWorkbook(buf);
    if (!r.ok) throw new Error(`ожидался успех: ${r.errors.join('; ')}`);
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => i.email)).toEqual(['ivan.petrov@yandex.ru']);
  });

  it('ссылка с форматированным текстом внутри (rich text) тоже принимается', async () => {
    const buf = await buildXlsx([
      {
        text: { richText: [{ text: 'olga' }, { font: { bold: true }, text: '@mail.ru' }] },
        hyperlink: 'mailto:olga@mail.ru',
      } as unknown as ExcelJS.CellValue,
    ]);
    const r = await parseEnrollmentImportWorkbook(buf);
    if (!r.ok) throw new Error(`ожидался успех: ${r.errors.join('; ')}`);
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => i.email)).toEqual(['olga@mail.ru']);
  });

  it('разбор ячейки берёт текст ссылки, а не адрес перехода и не «[object Object]»', () => {
    expect(cellToString({ text: 'a@b.ru', hyperlink: 'mailto:a@b.ru' })).toBe('a@b.ru');
    expect(
      cellToString({
        text: { richText: [{ text: 'x' }, { text: '@y.ru' }] },
        hyperlink: 'mailto:x@y.ru',
      } as unknown as ExcelJS.CellValue)
    ).toBe('x@y.ru');
  });
});
