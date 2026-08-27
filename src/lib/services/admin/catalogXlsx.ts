import ExcelJS from 'exceljs';
import { appendOverflowNotice, safeText, styleHeader } from '@/lib/services/export/xlsx';
import type { CatalogItemRow } from './catalogItems';
import { CATALOG_IMPORT_COLUMNS, catalogExportCells } from './catalogExcel';

/**
 * Xlsx-экспорт каталога услуг (`У-137`). Колонки — те же, что у шаблона
 * импорта (одна константа): выгрузку можно поправить и загрузить обратно,
 * сопоставление пройдёт по артикулу. Плюс информационная колонка «Активна» —
 * парсер импорта её игнорирует.
 */
export async function renderCatalogXlsx(rows: CatalogItemRow[], total: number): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';
  const ws = wb.addWorksheet('Каталог');
  ws.columns = [
    { header: CATALOG_IMPORT_COLUMNS.name, key: 'name', width: 40 },
    { header: CATALOG_IMPORT_COLUMNS.code, key: 'code', width: 16 },
    { header: CATALOG_IMPORT_COLUMNS.unit, key: 'unit', width: 10 },
    { header: CATALOG_IMPORT_COLUMNS.price, key: 'price', width: 14 },
    { header: CATALOG_IMPORT_COLUMNS.vatRate, key: 'vatRate', width: 14 },
    { header: CATALOG_IMPORT_COLUMNS.vatIncluded, key: 'vatIncluded', width: 12 },
    { header: CATALOG_IMPORT_COLUMNS.direction, key: 'direction', width: 30 },
    { header: CATALOG_IMPORT_COLUMNS.description, key: 'description', width: 40 },
    { header: CATALOG_IMPORT_COLUMNS.sortOrder, key: 'sortOrder', width: 10 },
    { header: 'Активна', key: 'isActive', width: 10 },
  ];
  for (const row of rows) {
    const c = catalogExportCells(row);
    ws.addRow({
      ...c,
      name: safeText(c.name),
      code: safeText(c.code),
      direction: safeText(c.direction),
      description: safeText(c.description),
    });
  }
  styleHeader(ws, rows.length > 0);
  appendOverflowNotice(ws, { total, noticeKey: 'name' });
  return wb.xlsx.writeBuffer();
}
