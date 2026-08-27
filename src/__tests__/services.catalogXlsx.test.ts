import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { renderCatalogXlsx } from '@/lib/services/admin/catalogXlsx';
import type { CatalogItemRow } from '@/lib/services/admin/catalogItems';

/**
 * `У-137` — рендерер экспорта каталога. Читаем СОБСТВЕННУЮ выгрузку обратно
 * ExcelJS'ом: проверяется файл, а не вызовы (ревью PR-2: рендерер не
 * исполнялся ни одним тестом — 0% на L3-гейте).
 */
function row(over: Partial<CatalogItemRow> = {}): CatalogItemRow {
  return {
    id: 'ci-1',
    name: 'Обучение',
    code: 'OT-101',
    unit: 'person',
    price: '4500.00',
    vatRate: null,
    vatIncluded: true,
    directionId: null,
    directionName: null,
    description: null,
    isActive: true,
    sortOrder: 0,
    ...over,
  };
}

async function readBack(buf: ArrayBuffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets[0]!;
}

describe('renderCatalogXlsx', () => {
  it('строки в формате, который парсер понимает обратно; формулы экранированы', async () => {
    const ws = await readBack(
      await renderCatalogXlsx(
        [
          row(),
          row({
            id: 'ci-2',
            name: '=ЗЛАЯ ФОРМУЛА',
            code: '-А1',
            unit: 'hour',
            vatRate: '0.2',
            vatIncluded: false,
            directionName: 'Охрана труда',
            description: 'Описание',
            isActive: false,
            sortOrder: 5,
          }),
        ],
        2
      )
    );
    expect(String(ws.getRow(1).getCell(1).value)).toContain('Название');
    const r1 = ws.getRow(2);
    expect(r1.getCell(3).value).toBe('чел.');
    expect(r1.getCell(5).value).toBe('не облагается');
    expect(r1.getCell(6).value).toBe('да');
    const r2 = ws.getRow(3);
    // OWASP: ведущие = и - экранированы апострофом (парсер импорта его снимает).
    expect(r2.getCell(1).value).toBe("'=ЗЛАЯ ФОРМУЛА");
    expect(r2.getCell(2).value).toBe("'-А1");
    expect(r2.getCell(5).value).toBe('20%');
    expect(r2.getCell(6).value).toBe('нет');
    expect(r2.getCell(7).value).toBe('Охрана труда');
    expect(r2.getCell(10).value).toBe('нет'); // Активна
  });

  it('пустой каталог — файл с одной шапкой, без сноски', async () => {
    const ws = await readBack(await renderCatalogXlsx([], 0));
    expect(ws.rowCount).toBe(1);
  });

  it('усечение честное: сноска «показаны первые N из M» при total больше строк', async () => {
    const ws = await readBack(await renderCatalogXlsx([row()], 12_345));
    const texts: string[] = [];
    ws.eachRow((r) => r.eachCell((c) => texts.push(String(c.value))));
    expect(texts.join(' ')).toContain('12345');
  });
});
