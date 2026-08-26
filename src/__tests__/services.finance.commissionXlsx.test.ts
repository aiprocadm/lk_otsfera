import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { renderCommissionStatementsXlsx } from '@/lib/services/finance/commissionXlsx';
import { EXPORT_ROW_LIMIT } from '@/lib/services/export/xlsx';
import type { StatementListItem } from '@/lib/services/partner/finance';

/**
 * `У-115`: выгрузка комиссионных отчётов партнёра — зеркало выгрузки платежей
 * заказчика. Проверяем колонки, русские статусы, защиту от формула-инъекции,
 * лист «Итоги» и предупреждение об усечении.
 */

const row = (over: Partial<StatementListItem> = {}): StatementListItem =>
  ({
    id: 's1',
    periodFrom: new Date('2026-07-01'),
    periodTo: new Date('2026-07-31'),
    status: 'approved',
    totalCommissionAmount: '12345.67',
    itemCount: 3,
    pdfPath: null,
    xlsxPath: null,
    ...over,
  }) as never as StatementListItem;

const kpis = { earnedTotal: 100, pendingTotal: 20, paidTotal: 80 };

async function load(buf: ExcelJS.Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

function headerValues(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.getRow(1).eachCell((c) => out.push(String(c.value)));
  return out;
}

describe('renderCommissionStatementsXlsx (У-115)', () => {
  it('лист отчётов: колонки, русский статус, суммы числом', async () => {
    const wb = await load(
      await renderCommissionStatementsXlsx({
        rows: [row()],
        total: 1,
        kpis,
        partnerName: 'ООО Партнёр',
      })
    );
    const ws = wb.getWorksheet('Комиссионные отчёты')!;
    expect(headerValues(ws)).toEqual([
      '№',
      'Период с',
      'Период по',
      'Статус',
      'Начислено, ₽',
      'Позиций',
    ]);
    const r = ws.getRow(2);
    expect(r.getCell(4).value).toBe('Утверждён');
    expect(r.getCell(5).value).toBe(12345.67);
    expect(r.getCell(6).value).toBe(3);
  });

  it('незнакомый статус показывается как есть, а не пустой ячейкой', async () => {
    const wb = await load(
      await renderCommissionStatementsXlsx({
        rows: [row({ status: 'weird' as never })],
        total: 1,
        kpis,
        partnerName: 'P',
      })
    );
    expect(wb.getWorksheet('Комиссионные отчёты')!.getRow(2).getCell(4).value).toBe('weird');
  });

  it('лист «Итоги» повторяет карточки экрана', async () => {
    const wb = await load(
      await renderCommissionStatementsXlsx({
        rows: [],
        total: 0,
        kpis,
        partnerName: 'ООО Партнёр',
      })
    );
    const totals = wb.getWorksheet('Итоги')!;
    const labels = [2, 3, 4, 5].map((i) => totals.getRow(i).getCell(1).value);
    expect(labels).toEqual(['Партнёр', 'Заработано, ₽', 'В обработке, ₽', 'Выплачено, ₽']);
    expect(totals.getRow(3).getCell(2).value).toBe(100);
  });

  it('имя партнёра, начинающееся с «=», не становится формулой', async () => {
    const wb = await load(
      await renderCommissionStatementsXlsx({
        rows: [],
        total: 0,
        kpis,
        partnerName: '=HYPERLINK("http://evil")',
      })
    );
    const cell = wb.getWorksheet('Итоги')!.getRow(2).getCell(2).value;
    expect(String(cell).startsWith('=')).toBe(false);
  });

  it('при усечении книга честно говорит, сколько строк осталось за бортом', async () => {
    const wb = await load(
      await renderCommissionStatementsXlsx({
        rows: [row()],
        total: EXPORT_ROW_LIMIT + 5,
        kpis,
        partnerName: 'P',
      })
    );
    const ws = wb.getWorksheet('Комиссионные отчёты')!;
    const text = JSON.stringify(ws.getRow(ws.rowCount).values);
    expect(text).toContain(String(EXPORT_ROW_LIMIT));
  });
});
