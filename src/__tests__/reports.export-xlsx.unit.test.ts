import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { buildReportXlsx } from '@/lib/reports/export';
import { REPORT_ROW_LIMIT, type ReportDefinition } from '@/lib/reports/registry';

/**
 * Сборка файла отчёта (`У-244`, этап 7).
 *
 * Главное здесь — предел: он ОТКАЗ, а не усечение, и считается до выборки.
 * Второе — защита от формула-инъекции: ячейка, начинающаяся с «=», в Excel
 * становится формулой, поэтому текст префиксуется кавычкой.
 */
const ctx = {
  prisma: {} as unknown as PrismaClient,
  session: { sub: 'l1', role: 'leader', companyId: 'c1' } as unknown as SessionPayload,
  companyId: 'c1',
  year: 2026,
  month: 9,
  olderThanDays: 0,
};

function report(over: Partial<ReportDefinition> = {}): ReportDefinition {
  return {
    key: 'receivables',
    title: 'Дебиторка',
    hint: 'Кто и сколько должен, как давно ждут и к кому идти.',
    audiences: ['staffLeader'],
    columns: [
      { key: 'organization', header: 'Организация' },
      { key: 'debt', header: 'Долг' },
    ],
    count: vi.fn(async () => 1),
    rows: vi.fn(async () => [{ organization: 'Ромашка', debt: 600 }]),
    ...over,
  } as ReportDefinition;
}

async function readBack(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets[0]!;
}

describe('buildReportXlsx', () => {
  it('собирает файл с шапкой и строками; имя файла несёт период', async () => {
    const res = await buildReportXlsx(report(), ctx);
    if (!res.ok) throw new Error('ожидался файл');
    expect(res.fileName).toBe('receivables-2026-09.xlsx');

    const ws = await readBack(res.buffer);
    expect(ws.getRow(1).getCell(1).value).toBe('Организация');
    expect(ws.getRow(2).getCell(1).value).toBe('Ромашка');
    // Числа остаются числами: иначе Excel не сложит колонку.
    expect(ws.getRow(2).getCell(2).value).toBe(600);
  });

  it('строк больше предела — отказ, и строки НЕ читаются', async () => {
    const rows = vi.fn(async () => []);
    const res = await buildReportXlsx(
      report({ count: vi.fn(async () => REPORT_ROW_LIMIT + 1), rows }),
      ctx
    );
    expect(res).toEqual({
      ok: false,
      error: 'too_many',
      total: REPORT_ROW_LIMIT + 1,
      limit: REPORT_ROW_LIMIT,
    });
    expect(rows, 'при отказе выборка всё-таки выполнилась').not.toHaveBeenCalled();
  });

  it('ровно предел — файл отдаётся, а не отказ', async () => {
    const res = await buildReportXlsx(report({ count: vi.fn(async () => REPORT_ROW_LIMIT) }), ctx);
    expect(res.ok).toBe(true);
  });

  it('текст с ведущим «=» обезврежен — Excel не примет его за формулу', async () => {
    const res = await buildReportXlsx(
      report({
        rows: vi.fn(async () => [{ organization: '=СУММ(A1:A9)', debt: 1 }]),
      }),
      ctx
    );
    if (!res.ok) throw new Error('ожидался файл');
    const ws = await readBack(res.buffer);
    expect(String(ws.getRow(2).getCell(1).value)).toBe("'=СУММ(A1:A9)");
  });

  it('пустой отчёт — файл с одной шапкой, а не ошибка', async () => {
    const res = await buildReportXlsx(
      report({ count: vi.fn(async () => 0), rows: vi.fn(async () => []) }),
      ctx
    );
    if (!res.ok) throw new Error('ожидался файл');
    const ws = await readBack(res.buffer);
    expect(ws.getRow(1).getCell(1).value).toBe('Организация');
    expect(ws.rowCount).toBe(1);
  });
});
