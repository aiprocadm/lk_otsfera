import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

import { buildDebtsReport } from '@/lib/services/oneCSync/debtsReport';
import { countLastDebtMismatches } from '@/lib/services/oneCSync/debtMismatches';

/**
 * Отчёт «Расхождения по дебиторке» и счётчик оповещения (`У-257`).
 *
 * Оба читают ОДНУ запись журнала обмена и обязаны выдерживать её содержимое
 * в любом виде: строка могла быть записана прежней версией, обрезана вручную
 * или вовсе не про долги. Падать на этом нельзя — на счётчике висит
 * оповещение дежурному, а на отчёте работа бухгалтера.
 */
function db(row: unknown) {
  const findFirst = vi.fn().mockResolvedValue(row);
  const findUnique = vi.fn().mockResolvedValue(row);
  return {
    prisma: { syncLog: { findFirst, findUnique } } as unknown as PrismaClient,
    findFirst,
    findUnique,
  };
}

const MISMATCH = {
  orderId: 'o1',
  orderNumber: 'ON-1',
  organizationName: 'ООО Ромашка',
  ours: '60000.00',
  theirs: '45000.00',
  diff: '15000.00',
};

const logRow = (payload: unknown) => ({
  id: 'log-1',
  createdAt: new Date('2026-09-18T10:00:00Z'),
  entity: 'debt',
  payload,
});

async function sheetRows(buffer: Uint8Array): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const out: string[][] = [];
  wb.worksheets[0]!.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell((c) => cells.push(String(c.value ?? '')));
    out.push(cells);
  });
  return out;
}

describe('buildDebtsReport', () => {
  it('сверки ещё не было — отказ, а не пустой файл без объяснения', async () => {
    expect(await buildDebtsReport(db(null).prisma)).toEqual({ ok: false, error: 'not_found' });
  });

  it('по прямой ссылке на ЧУЖУЮ запись журнала отчёт не собирается', async () => {
    // Иначе выгрузка стала бы универсальным просмотрщиком журнала обмена:
    // подставил чужой `logId` — увидел чужие данные.
    const { prisma } = db({ ...logRow([]), entity: 'order' });
    expect(await buildDebtsReport(prisma, { logId: 'log-9' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('расхождения из записи попадают в файл строками', async () => {
    const { prisma } = db(logRow({ channel: 'http', mismatches: [MISMATCH] }));
    const res = await buildDebtsReport(prisma);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mismatches).toBe(1);
    const rows = await sheetRows(res.buffer);
    expect(rows[0]).toContain('Организация');
    expect(rows[1]).toEqual(['ON-1', 'ООО Ромашка', '60000.00', '45000.00', '15000.00']);
  });

  it('у расхождения нет номера заказа и названия — подставляются id и прочерк', async () => {
    // Заказ мог приехать из 1С без номера, а организацию могли удалить.
    // Пустые ячейки в файле бухгалтер прочитал бы как «строка битая».
    const { prisma } = db(
      logRow({
        mismatches: [{ ...MISMATCH, orderNumber: null, organizationName: null }],
      })
    );
    const res = await buildDebtsReport(prisma);
    if (!res.ok) throw new Error('ожидали ok');
    const rows = await sheetRows(res.buffer);
    expect(rows[1]![0]).toBe('o1');
    expect(rows[1]![1]).toBe('—');
  });

  it('содержимое записи не про расхождения — файл с одной шапкой, а не отказ', async () => {
    // Строку мог записать прежний формат. «Сверка была, расхождений нет» —
    // честный ответ; отказ человек прочитал бы как «отчёт сломался».
    for (const payload of [null, 'строка', [1, 2, 3], { mismatches: 'не массив' }, {}]) {
      const { prisma } = db(logRow(payload));
      const res = await buildDebtsReport(prisma);
      expect(res.ok, JSON.stringify(payload)).toBe(true);
      if (!res.ok) continue;
      expect(res.mismatches).toBe(0);
      expect(await sheetRows(res.buffer)).toHaveLength(1);
    }
  });
});

describe('countLastDebtMismatches', () => {
  it('сверок не было — ноль, а не ошибка на оценке оповещений', async () => {
    expect(await countLastDebtMismatches(db(null).prisma)).toBe(0);
  });

  it('считает расхождения ПОСЛЕДНЕЙ сверки', async () => {
    const { prisma, findFirst } = db({ payload: { mismatches: [MISMATCH, MISMATCH] } });
    expect(await countLastDebtMismatches(prisma)).toBe(2);
    expect(findFirst.mock.calls[0]![0]).toMatchObject({
      where: { entity: 'debt', operation: 'reconcile' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('любое неожиданное содержимое записи читается как ноль', async () => {
    for (const payload of [null, 'строка', [1, 2], { mismatches: 7 }, {}]) {
      expect(await countLastDebtMismatches(db({ payload }).prisma), String(payload)).toBe(0);
    }
  });
});
