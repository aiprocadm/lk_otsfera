import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { commitPaymentImport } from '@/lib/services/import/oneCAccountCard/import-batch';

/**
 * `У-88` на живом Postgres: строка выписки, у которой ИНН нет (или он кривой),
 * но название совпадает с организацией компании импорта, привязывается сама —
 * по ключу названия (`У-83`), без ручного разбора.
 *
 * Проверяется и граница изоляции (C8): организация ДРУГОЙ компании с тем же
 * названием не матчится, такая строка уходит в очередь.
 */
const prisma = new PrismaClient();
const STAMP = Date.now();
const SUFFIX = String(STAMP).slice(-6);

const DOC_SAME = `${SUFFIX}-201`;
const DOC_FOREIGN = `${SUFFIX}-202`;
// Одна и та же организация в трёх написаниях — ключ обязан быть один.
const ORG_IN_DB = `Ромашка-${STAMP} ООО`;
const ORG_IN_FILE = `ООО «Ромашка-${STAMP}»`;
const FOREIGN_IN_FILE = `АО «Вектор-${STAMP}»`;

let adminSession: never;
let adminUserId: string;
let companyId = '';
let foreignCompanyId = '';

async function statement(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.addRow(['Сальдо на начало']);
  // Обе строки БЕЗ ИНН — раньше такие всегда уходили в очередь.
  for (const [doc, name] of [
    [DOC_SAME, ORG_IN_FILE],
    [DOC_FOREIGN, FOREIGN_IN_FILE],
  ] as const) {
    ws.addRow([
      '03.08.2026',
      `Поступление на расчетный счет ${doc} от 03.08.2026 10:00:00\nОплата по договору`,
      '',
      name,
      '',
      '5000',
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
      email: `st1-namekey-${STAMP}@test.local`,
      name: 'Админ этапа 1',
      role: 'admin',
      passwordHash: 'x',
    },
  });
  adminUserId = admin.id;
  adminSession = { sub: admin.id, role: 'admin', companyId: null } as never;
  const own = await prisma.company.create({ data: { name: `Своя компания ${STAMP}` } });
  const foreign = await prisma.company.create({ data: { name: `Чужая компания ${STAMP}` } });
  companyId = own.id;
  foreignCompanyId = foreign.id;

  // Организация своей компании — в другом написании, чем в файле.
  await prisma.organization.create({
    data: { name: ORG_IN_DB, nameKey: `РОМАШКА ${STAMP}`, companyId },
  });
  // Тёзка в чужой компании — по ключу матчиться НЕ должен (C8).
  await prisma.organization.create({
    data: { name: FOREIGN_IN_FILE, nameKey: `ВЕКТОР ${STAMP}`, companyId: foreignCompanyId },
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { externalId: { in: [DOC_SAME, DOC_FOREIGN] } } });
  await prisma.paymentImportRow.deleteMany({
    where: { externalId: { in: [DOC_SAME, DOC_FOREIGN] } },
  });
  await prisma.paymentImportBatch.deleteMany({ where: { importedById: adminUserId } });
  await prisma.organization.deleteMany({
    where: { companyId: { in: [companyId, foreignCompanyId] } },
  });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, foreignCompanyId] } } });
  await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('У-88 — привязка по ключу названия (живой Postgres)', () => {
  it('строка без ИНН привязывается к организации своей компании; тёзка чужой компании — в очередь', async () => {
    const res = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: await statement(),
      fileName: 'st1-namekey.xlsx',
      companyId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Организаций импорт не заводил — обе строки решились или ушли в очередь.
    expect(res.result.counts.orgsCreated).toBe(0);

    const own = await prisma.organization.findFirst({
      where: { companyId, nameKey: `РОМАШКА ${STAMP}` },
      select: { id: true },
    });
    const paid = await prisma.payment.findMany({
      where: { externalId: DOC_SAME },
      select: { organizationId: true },
    });
    expect(paid).toHaveLength(1);
    expect(paid[0]!.organizationId).toBe(own!.id);

    // Чужая компания: платёж не записан, строка ждёт ручного разбора.
    expect(await prisma.payment.count({ where: { externalId: DOC_FOREIGN } })).toBe(0);
    const queued = await prisma.paymentImportRow.findFirst({
      where: { externalId: DOC_FOREIGN },
      select: { status: true, counterpartyKey: true },
    });
    expect(queued?.status).toBe('needs_review');
    // `У-83`: у строки очереди есть ключ — по нему её найдёт группировка.
    expect(queued?.counterpartyKey).toBe(`ВЕКТОР ${STAMP}`);
  });
});
