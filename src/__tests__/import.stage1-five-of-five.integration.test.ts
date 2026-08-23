import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

// `У-85`: ЕГРЮЛ подменяем — тест обязан быть воспроизводимым без сети.
const { suggestParty } = vi.hoisted(() => ({ suggestParty: vi.fn() }));
vi.mock('@/lib/services/dadata/suggestParty', () => ({ suggestParty }));
vi.mock('@/lib/services/admin/integrations', () => ({ isDadataEnabled: () => true }));

import { commitPaymentImport } from '@/lib/services/import/oneCAccountCard/import-batch';
import { rollbackImport } from '@/lib/services/import/rollback';
import { resetDadataInnCache } from '@/lib/services/import/oneCAccountCard/dadata-inn';

/**
 * `У-93` — регресс исходной жалобы «загрузил выписку, а создалось три
 * организации из десятков».
 *
 * Пять контрагентов, ИНН в файле только у одного, ЕГРЮЛ отвечает по двум.
 * Ожидание: организаций **пять**, все платежи привязаны, очередь пуста,
 * откат возвращает состояние. Без этого теста «зелёные юниты» ничего не
 * доказывают: ломается связка «разбор → кандидаты → создание → ре-матч».
 */
const prisma = new PrismaClient();
const STAMP = Date.now();
const SUFFIX = String(STAMP).slice(-6);

function makeInn10(seed9: string): string {
  const d = [...seed9].map(Number);
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const control = (w.reduce((acc, wi, i) => acc + wi * (d[i] ?? 0), 0) % 11) % 10;
  return seed9 + String(control);
}

const INN_FILE = makeInn10(`91${String(STAMP).slice(-7)}`);
const INN_EGRUL_A = makeInn10(`92${String(STAMP).slice(-7)}`);
const INN_EGRUL_B = makeInn10(`93${String(STAMP).slice(-7)}`);

// Пять контрагентов: один с ИНН в файле, два «узнаются» в ЕГРЮЛ, два остаются
// без ИНН вовсе. Названия уникальны штампом — прогоны не мешают друг другу.
const PARTIES = [
  { doc: `${SUFFIX}-301`, name: `АЛЬФА-${STAMP} ООО ИНН ${INN_FILE}`, key: `АЛЬФА ${STAMP}` },
  { doc: `${SUFFIX}-302`, name: `БЕТА-${STAMP} ООО`, key: `БЕТА ${STAMP}` },
  { doc: `${SUFFIX}-303`, name: `ГАММА-${STAMP} АО`, key: `ГАММА ${STAMP}` },
  { doc: `${SUFFIX}-304`, name: `ДЕЛЬТА-${STAMP} ООО`, key: `ДЕЛЬТА ${STAMP}` },
  { doc: `${SUFFIX}-305`, name: `ЭПСИЛОН-${STAMP} ООО`, key: `ЭПСИЛОН ${STAMP}` },
];
const DOCS = PARTIES.map((p) => p.doc);

let adminSession: never;
let adminUserId: string;
let companyId = '';

async function statement(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.addRow(['Сальдо на начало']);
  for (const p of PARTIES) {
    ws.addRow([
      '05.08.2026',
      `Поступление на расчетный счет ${p.doc} от 05.08.2026 10:00:00\nОплата по договору`,
      '',
      p.name,
      '',
      '3000',
      '',
      '62.01',
    ]);
  }
  ws.addRow(['Обороты за период и сальдо на конец']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      email: `st1-five-${STAMP}@test.local`,
      name: 'Админ этапа 1',
      role: 'admin',
      passwordHash: 'x',
    },
  });
  adminUserId = admin.id;
  adminSession = { sub: admin.id, role: 'admin', companyId: null } as never;
  const company = await prisma.company.create({ data: { name: `Компания пяти ${STAMP}` } });
  companyId = company.id;

  resetDadataInnCache();
  // ЕГРЮЛ знает «Бету» и «Гамму»; по остальным — молчит либо отвечает двусмысленно.
  suggestParty.mockImplementation(async (_db: unknown, query: string) => {
    if (query === `БЕТА ${STAMP}`) {
      return [
        {
          name: `ООО «Бета-${STAMP}»`,
          inn: INN_EGRUL_A,
          kpp: null,
          ogrn: null,
          address: null,
          status: 'ACTIVE',
          opf: 'ООО',
        },
      ];
    }
    if (query === `ГАММА ${STAMP}`) {
      return [
        {
          name: `АО «Гамма-${STAMP}»`,
          inn: INN_EGRUL_B,
          kpp: null,
          ogrn: null,
          address: null,
          status: 'ACTIVE',
          opf: 'АО',
        },
      ];
    }
    if (query === `ДЕЛЬТА ${STAMP}`) {
      // Две записи с одинаковым ключом — ИНН не подставляем (`У-85`).
      return [
        { name: `ООО «Дельта-${STAMP}»`, inn: makeInn10('941111111'), kpp: null, ogrn: null, address: null, status: 'ACTIVE', opf: 'ООО' },
        { name: `АО «Дельта-${STAMP}»`, inn: makeInn10('951111111'), kpp: null, ogrn: null, address: null, status: 'ACTIVE', opf: 'АО' },
      ];
    }
    return [];
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { externalId: { in: DOCS } } });
  await prisma.paymentImportRow.deleteMany({ where: { externalId: { in: DOCS } } });
  await prisma.paymentImportWrite.deleteMany({ where: { batch: { importedById: adminUserId } } });
  await prisma.paymentImportBatch.deleteMany({ where: { importedById: adminUserId } });
  await prisma.organization.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('У-93 — «пять из пяти» (живой Postgres)', () => {
  it('пять контрагентов → пять организаций, платежи привязаны, очередь пуста; откат возвращает всё', async () => {
    const res = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: await statement(),
      fileName: 'st1-five.xlsx',
      companyId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Жалоба заказчика звучала как «создалось три из многих» — здесь ровно пять.
    expect(res.result.counts.orgsCreated).toBe(5);

    const orgs = await prisma.organization.findMany({
      where: { companyId },
      select: { id: true, name: true, inn: true, nameKey: true },
    });
    expect(orgs).toHaveLength(5);
    // ИНН: один из файла, два из ЕГРЮЛ, два — пустые (и это нормально).
    const inns = orgs.map((o) => o.inn).filter(Boolean).sort();
    expect(inns).toEqual([INN_FILE, INN_EGRUL_A, INN_EGRUL_B].sort());
    expect(orgs.filter((o) => !o.inn)).toHaveLength(2);

    const payments = await prisma.payment.findMany({
      where: { externalId: { in: DOCS } },
      select: { externalId: true, organizationId: true },
    });
    expect(payments).toHaveLength(5);
    expect(payments.every((p) => !!p.organizationId)).toBe(true);
    // Очередь ручного разбора пуста — разбирать нечего.
    expect(
      await prisma.paymentImportRow.count({ where: { externalId: { in: DOCS } } })
    ).toBe(0);

    // Повторный импорт того же файла дублей не плодит (`У-86`).
    const again = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: await statement(),
      fileName: 'st1-five.xlsx',
      companyId,
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.result.counts.orgsCreated).toBe(0);
    expect(await prisma.organization.count({ where: { companyId } })).toBe(5);

    // `У-93`: откат первого батча возвращает состояние — организации, которые
    // завёл импорт, исчезают вместе с платежами.
    const batches = await prisma.paymentImportBatch.findMany({
      where: { importedById: adminUserId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const second = batches[1]!;
    const rolledSecond = await rollbackImport(prisma, adminSession, {
      batchId: second.id,
      partial: false,
      // Канал обязателен: по умолчанию откат ищет батч Excel-импорта.
      channel: 'statement',
    });
    expect(rolledSecond).toMatchObject({ ok: true });

    const first = batches[0]!;
    const rolled = await rollbackImport(prisma, adminSession, {
      batchId: first.id,
      partial: false,
      channel: 'statement',
    });
    expect(rolled).toMatchObject({ ok: true, status: 'rolled_back' });
    expect(await prisma.payment.count({ where: { externalId: { in: DOCS } } })).toBe(0);
    expect(await prisma.organization.count({ where: { companyId } })).toBe(0);
  });
});
