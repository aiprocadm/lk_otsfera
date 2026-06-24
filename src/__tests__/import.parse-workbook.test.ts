import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '@/lib/services/import/parse-workbook';
import { SHEET_NAMES, PAYMENT_COLS } from '@/lib/services/import/column-map';

async function buildBook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAMES.payments);
  ws.addRow([PAYMENT_COLS.externalId, PAYMENT_COLS.orgInn, PAYMENT_COLS.amount, PAYMENT_COLS.paidAt, PAYMENT_COLS.purpose]);
  ws.addRow(['PP-1', '7700', 1000, '2026-04-20', 'аванс']);
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

describe('parseWorkbook', () => {
  it('maps headers to DTO fields by column-map', async () => {
    const { payments } = await parseWorkbook(await buildBook());
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ externalId: 'PP-1', orgInn: '7700', amount: 1000, purpose: 'аванс' });
  });
  it('returns empty arrays for missing sheets without throwing', async () => {
    const { orgs, orders } = await parseWorkbook(await buildBook());
    expect(orgs).toEqual([]);
    expect(orders).toEqual([]);
  });
});
