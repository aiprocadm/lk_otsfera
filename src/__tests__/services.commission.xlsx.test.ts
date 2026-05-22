import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { renderStatementXlsx } from '@/lib/services/commission/xlsx';

const baseStatement = {
  id: 'stmt-1',
  periodFrom: new Date('2026-04-01'),
  periodTo: new Date('2026-04-30'),
  calculatedAt: new Date('2026-05-01'),
  totalBaseAmount: 200000 as any,
  averageRate: 0.08 as any,
  totalCommissionAmount: 16000 as any,
  status: 'draft' as const,
};

const baseItems = [
  {
    id: 'item-1',
    orderNumber: 'ORD-001',
    organizationName: 'ООО Тест',
    baseAmount: 100000 as any,
    rate: 0.08 as any,
    commissionAmount: 8000 as any,
  },
  {
    id: 'item-2',
    orderNumber: 'ORD-002',
    organizationName: 'АО Тест-2',
    baseAmount: 100000 as any,
    rate: 0.08 as any,
    commissionAmount: 8000 as any,
  },
];

const partner = { name: 'ПромТест' };

describe('renderStatementXlsx', () => {
  it('returns a non-empty Buffer', async () => {
    const buf = await renderStatementXlsx({ statement: baseStatement as any, items: baseItems as any, partner });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('Items sheet has N+1 rows (header + items)', async () => {
    const buf = await renderStatementXlsx({ statement: baseStatement as any, items: baseItems as any, partner });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.getWorksheet('Items');
    expect(sheet).toBeDefined();
    // header row + 2 items
    expect(sheet!.rowCount).toBe(3);
  });

  it('Summary sheet exists with partner name', async () => {
    const buf = await renderStatementXlsx({ statement: baseStatement as any, items: baseItems as any, partner });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const summary = wb.getWorksheet('Summary');
    expect(summary).toBeDefined();
    // First column contains field labels, second column contains values
    const rows = summary!.getSheetValues() as string[][];
    const flat = rows.flat().filter(Boolean).map(String);
    expect(flat).toContain(partner.name);
  });

  it('handles empty items list', async () => {
    const buf = await renderStatementXlsx({
      statement: { ...baseStatement, totalBaseAmount: 0 as any, totalCommissionAmount: 0 as any } as any,
      items: [],
      partner,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.getWorksheet('Items');
    // header row only
    expect(sheet!.rowCount).toBe(1);
  });
});
