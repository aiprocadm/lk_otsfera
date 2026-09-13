import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

import { buildBitrixReport } from '@/lib/services/bitrix/report';
import { BITRIX_ENTITIES, BITRIX_ENTITY_TITLES } from '@/lib/services/bitrix/mapping/types';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-198`): отчёт сверки — документ приёмки. По нему
 * человек решает, выключать ли Битрикс24, поэтому строк в отчёте обязано быть
 * ровно столько же, сколько записей сделал перенос.
 *
 * Страж сверяет отчёт с журналом пакета построчно, на живой базе. Самый
 * вероятный регресс — «добавлю фильтр на листе» или «возьму первые N»: в
 * отчёте станет меньше строк, чем в базе, и молчаливое усечение выдаст себя
 * только на приёмке, когда сверять уже поздно.
 */
let prisma: PrismaClient;
const STAMP = Date.now();
const ids = { company: '', user: '', batch: '' };

/** Сколько строк журнала завести на каждую сущность — числа намеренно разные. */
const PLAN: Record<string, number> = {
  organization: 3,
  contact: 5,
  lead: 2,
  deal: 4,
  note: 1,
  task: 6,
  file: 2,
  order: 1,
};

beforeAll(async () => {
  prisma = new PrismaClient();
  const company = await prisma.company.create({
    data: { name: `Отчёт сверки ${STAMP}` },
    select: { id: true },
  });
  ids.company = company.id;
  const user = await prisma.user.create({
    data: {
      email: `bitrix-report-${STAMP}@test.local`,
      name: 'Администратор сверки',
      role: 'admin',
      passwordHash: 'x',
      companyId: company.id,
    },
    select: { id: true },
  });
  ids.user = user.id;
  const batch = await prisma.bitrixImportBatch.create({
    data: {
      companyId: ids.company,
      importedById: ids.user,
      source: 'file',
      status: 'applied',
      appliedAt: new Date(),
      counts: {},
      settings: {
        rows: [
          {
            entity: 'contact',
            bitrixId: 'c-1',
            title: 'Иванов',
            action: 'conflict',
            reason: 'занят канал',
          },
          { entity: 'lead', bitrixId: 'l-1', title: 'Заявка', action: 'skip', reason: 'нет темы' },
          {
            entity: 'organization',
            bitrixId: 'o-1',
            title: 'ООО Ромашка',
            action: 'update',
            reason: 'оставлено ручное значение: name',
          },
        ],
        rollbackConflicts: [
          { entity: 'order', entityId: 'x', label: '№ 42', code: 'order_has_payments', count: 2 },
        ],
      },
      errors: [],
    },
    select: { id: true },
  });
  ids.batch = batch.id;

  for (const [entity, n] of Object.entries(PLAN)) {
    for (let i = 0; i < n; i += 1) {
      await prisma.bitrixImportWrite.create({
        data: {
          batchId: ids.batch,
          entity,
          entityId: `${entity}-row-${i}-${STAMP}`,
          bitrixId: `${STAMP}-${entity}-${i}`,
          action: i === 0 ? 'updated' : 'created',
          ...(i === 0 ? { before: { name: 'Было' } } : {}),
          after: { name: `Стало ${i}` },
        },
      });
    }
  }
});

afterAll(async () => {
  await prisma.bitrixImportWrite.deleteMany({ where: { batchId: ids.batch } });
  await prisma.bitrixImportBatch.deleteMany({ where: { companyId: ids.company } });
  await prisma.user.deleteMany({ where: { companyId: ids.company } });
  await prisma.company.deleteMany({ where: { id: ids.company } });
  await prisma.$disconnect();
});

describe('У-198: отчёт сверки совпадает с журналом пакета', () => {
  it('на каждом листе сущности ровно столько строк, сколько записей в журнале', async () => {
    const buffer = await buildBitrixReport(prisma, ids.batch);
    expect(buffer, 'отчёт не собрался').not.toBeNull();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    for (const entity of BITRIX_ENTITIES) {
      const ws = wb.getWorksheet(BITRIX_ENTITY_TITLES[entity]);
      expect(ws, `нет листа «${BITRIX_ENTITY_TITLES[entity]}»`).toBeDefined();
      const journal = await prisma.bitrixImportWrite.count({
        where: { batchId: ids.batch, entity },
      });
      // Первая строка — шапка, поэтому строк данных на единицу меньше.
      expect(ws!.rowCount - 1, `лист «${BITRIX_ENTITY_TITLES[entity]}»`).toBe(journal);
      expect(journal).toBe(PLAN[entity]);
    }
  });

  it('идентификаторы на листе — те же, что в журнале', async () => {
    const buffer = await buildBitrixReport(prisma, ids.batch);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    const ws = wb.getWorksheet(BITRIX_ENTITY_TITLES.contact)!;
    const fromSheet: string[] = [];
    ws.eachRow((row, index) => {
      if (index === 1) return;
      fromSheet.push(String(row.getCell(1).value));
    });
    const fromDb = await prisma.bitrixImportWrite.findMany({
      where: { batchId: ids.batch, entity: 'contact' },
      select: { bitrixId: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(fromSheet.sort()).toEqual(fromDb.map((r) => r.bitrixId).sort());
  });

  it('листы разбора переноса на месте и несут свои строки', async () => {
    const buffer = await buildBitrixReport(prisma, ids.batch);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    // Конфликт переноса + конфликт отката = две строки данных.
    expect(wb.getWorksheet('Конфликты')!.rowCount - 1).toBe(2);
    expect(wb.getWorksheet('Пропущено')!.rowCount - 1).toBe(1);
    expect(wb.getWorksheet('Оставлено ручное')!.rowCount - 1).toBe(1);
  });
});
