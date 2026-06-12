import ExcelJS from 'exceljs';
import type { CommissionStatement, CommissionStatementItem } from '@prisma/client';

export type RenderStatementXlsxArgs = {
  statement: CommissionStatement;
  items: CommissionStatementItem[];
  partner: { name: string };
};

const BRAND_COLOR = '1E40AF';
const HEADER_FONT_COLOR = 'FFFFFFFF';

function n(val: unknown): number {
  return Number(val) || 0;
}

// Neutralise spreadsheet formula injection (OWASP CSV injection): a cell whose
// text begins with = + - @ (or a leading tab/CR) is interpreted as a formula by
// Excel/LibreOffice/Sheets. Prefix a single quote to force literal text.
function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function periodLabel(from: Date, to: Date): string {
  const f = new Date(from);
  const t = new Date(to);
  return `${f.toLocaleDateString('ru-RU')} — ${t.toLocaleDateString('ru-RU')}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function renderStatementXlsx(args: RenderStatementXlsxArgs): Promise<any> {
  const { statement, items, partner } = args;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Промтехносфера';
  wb.created = new Date(statement.calculatedAt);

  // ─── Sheet 1: Items ───────────────────────────────────────────────
  const ws = wb.addWorksheet('Items');

  ws.columns = [
    { header: '№',            key: 'num',              width: 6  },
    { header: 'Заказ',        key: 'orderNumber',      width: 18 },
    { header: 'Организация',  key: 'organizationName', width: 36 },
    { header: 'База, ₽',      key: 'baseAmount',       width: 16 },
    { header: 'Ставка',       key: 'rate',             width: 10 },
    { header: 'Комиссия, ₽',  key: 'commissionAmount', width: 16 },
  ];

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND_COLOR } };
    cell.font  = { color: { argb: HEADER_FONT_COLOR }, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  headerRow.height = 20;

  // Freeze header
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

  // Auto-filter on header row
  if (items.length > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };
  }

  // Data rows
  items.forEach((item, idx) => {
    const row = ws.addRow({
      num: idx + 1,
      orderNumber: safeText(item.orderNumber ?? '—'),
      organizationName: safeText(item.organizationName),
      baseAmount: n(item.baseAmount),
      rate: n(item.rate),
      commissionAmount: n(item.commissionAmount),
    });

    // Right-align numbers, format as currency / percent
    row.getCell('baseAmount').numFmt = '#,##0.00';
    row.getCell('rate').numFmt = '0.00%';
    row.getCell('commissionAmount').numFmt = '#,##0.00';
    row.getCell('num').alignment = { horizontal: 'center' };

    // Alternating row shading
    if (idx % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      });
    }
  });

  // ─── Sheet 2: Summary ─────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Summary');
  ws2.columns = [
    { key: 'field', width: 28 },
    { key: 'value', width: 36 },
  ];

  const summaryRows: [string, string | number][] = [
    ['Партнёр',         safeText(partner.name)],
    ['Период',          periodLabel(statement.periodFrom, statement.periodTo)],
    ['Статус',          safeText(statement.status)],
    ['Сформировано',    new Date(statement.calculatedAt).toLocaleDateString('ru-RU')],
    ['Итого база, ₽',   n(statement.totalBaseAmount)],
    ['Средняя ставка',  n(statement.averageRate)],
    ['Итого комиссия, ₽', n(statement.totalCommissionAmount)],
  ];

  summaryRows.forEach(([field, value]) => {
    const row = ws2.addRow({ field, value });
    row.getCell('field').font = { bold: true };
    if (field.includes('ставка')) {
      row.getCell('value').numFmt = '0.00%';
    } else if (field.includes('₽')) {
      row.getCell('value').numFmt = '#,##0.00';
    }
  });

  return wb.xlsx.writeBuffer();
}
