import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { commitPaymentImport } from '@/lib/services/import/oneCAccountCard/import-batch';
import { resolveQueueRow } from '@/lib/services/import/oneCAccountCard/resolve-queue';

const prisma = new PrismaClient();
const adminSession = { sub: 'admin-it', role: 'admin', companyId: null } as never;

async function cardBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.addRow(['Сальдо на начало']);
  // оплата по ИНН (org-level), ИНН известен
  ws.addRow([
    '01.06.2026',
    'Поступление на расчетный счет 0000-000101 от 01.06.2026 10:00:00\nОплата по счету № IT-1 В Т.Ч. НДС (5%) 100-00',
    '',
    'ТЕСТ ОРГ ООО ИНН 7712345678',
    '',
    '21000',
    '',
    '62.01',
  ]);
  // Нет ИНН, незнакомое имя. До этапа 1 такая строка уходила в очередь; по
  // `У-86` импорт заводит организацию по названию и привязывает платёж.
  ws.addRow([
    '02.06.2026',
    'Поступление на расчетный счет 0000-000102 от 02.06.2026 10:00:00\nОплата по счету № IT-2',
    '',
    'НЕИЗВЕСТНАЯ КОМПАНИЯ',
    '',
    '5000',
    '',
    '62.01',
  ]);
  // поставщик 60 → excluded
  ws.addRow([
    '03.06.2026',
    'Списание с расчетного счета 0000-000103 от 03.06.2026 10:00:00\nоплата поставщику',
    '',
    'ПОСТАВЩИК',
    '',
    '',
    '',
    '60',
    '900',
  ]);
  ws.addRow(['Обороты за период и сальдо на конец']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

let orgId = '';
let companyId = '';
beforeAll(async () => {
  // PaymentImportBatch.importedById has a real FK to User → session.sub must be a real user id.
  await prisma.user.create({
    data: { id: 'admin-it', email: 'admin-it@card51.test', name: 'IT Admin', role: 'admin' },
  });
  const company = await prisma.company.create({ data: { name: 'IT Co' } });
  companyId = company.id;
  const org = await prisma.organization.create({
    data: { name: 'ТЕСТ ОРГ ООО', inn: '7712345678', companyId: company.id },
  });
  orgId = org.id;
});
afterAll(async () => {
  await prisma.payment.deleteMany({
    where: { externalId: { in: ['0000-000101', '0000-000102'] } },
  });
  await prisma.paymentImportRow.deleteMany({
    where: { externalId: { in: ['0000-000101', '0000-000102'] } },
  });
  await prisma.paymentImportWrite.deleteMany({ where: { batch: { importedById: 'admin-it' } } });
  await prisma.paymentImportBatch.deleteMany({ where: { importedById: 'admin-it' } });
  // Убираем ВСЕ организации компании, а не только фикстурную по ИНН: по `У-86`
  // импорт заводит организации сам, и уборка по одному ИНН оставляла бы их
  // бесхозными после удаления компании (мусор копился каждым прогоном).
  await prisma.organization.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { name: 'IT Co' } });
  // commitPaymentImport writes audit logs keyed to session.sub → clear before deleting the user (FK).
  await prisma.auditLog.deleteMany({ where: { userId: 'admin-it' } });
  await prisma.user.deleteMany({ where: { id: 'admin-it' } });
  await prisma.$disconnect();
});

describe('card-51 import (integration)', () => {
  // `Р-11`/`У-86`: правило «нет ИНН → очередь» отменено. Проверяем новое:
  // знакомый ИНН привязывается к существующей организации, незнакомый
  // контрагент заводится по названию, поставщик (60) по-прежнему исключается.
  it('commits: ИНН → существующая организация, новый контрагент → создан, поставщик → excluded', async () => {
    const buf = await cardBuffer();
    const res = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: buf,
      fileName: 'card.xlsx',
      // `У-86`: контрагент без ИНН — тоже кандидат, поэтому админ выбирает
      // компанию (форма подставляет единственную автоматически).
      companyId,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.counts.imported).toBe(2);
      expect(res.result.counts.queued).toBe(0);
      expect(res.result.counts.excluded).toBe(1);
      expect(res.result.counts.orgsCreated).toBe(1);
    }
    const pay = await prisma.payment.findUnique({ where: { externalId: '0000-000101' } });
    expect(pay?.organizationId).toBe(orgId);
    expect(Number(pay?.vatAmount)).toBe(100);
    // Второй платёж привязан к организации, которую импорт завёл по названию.
    const created = await prisma.payment.findUnique({ where: { externalId: '0000-000102' } });
    expect(created?.organizationId).toBeTruthy();
    expect(created?.organizationId).not.toBe(orgId);
    const newOrg = await prisma.organization.findFirst({
      where: { companyId, nameKey: 'НЕИЗВЕСТНАЯ КОМПАНИЯ' },
      select: { inn: true },
    });
    expect(newOrg).not.toBeNull();
    // ИНН в файле нет, ЕГРЮЛ в тестовой среде выключен — организация без ИНН.
    expect(newOrg?.inn).toBeNull();
    // Очередь пуста: разбирать руками больше нечего.
    expect(
      await prisma.paymentImportRow.count({ where: { externalId: '0000-000102' } })
    ).toBe(0);
  });

  it('is idempotent: re-import creates no duplicates', async () => {
    const buf = await cardBuffer();
    await commitPaymentImport(prisma, adminSession, {
      fileBuffer: buf,
      fileName: 'card.xlsx',
      companyId,
    });
    const payCount = await prisma.payment.count({ where: { externalId: '0000-000101' } });
    const secondPay = await prisma.payment.count({ where: { externalId: '0000-000102' } });
    expect(payCount).toBe(1);
    expect(secondPay).toBe(1);
    // `У-86`: повторный импорт не заводит второго «двойника» по названию.
    expect(
      await prisma.organization.count({ where: { companyId, nameKey: 'НЕИЗВЕСТНАЯ КОМПАНИЯ' } })
    ).toBe(1);
  });

  it('resolveQueueRow promotes a queue row to Payment', async () => {
    // Строка очереди теперь появляется, только когда создавать нечего (нет ни
    // ИНН, ни названия), — заводим её явно, чтобы проверить ручную привязку.
    const batch = await prisma.paymentImportBatch.findFirst({
      where: { importedById: 'admin-it' },
      select: { id: true },
    });
    const row = await prisma.paymentImportRow.create({
      data: {
        batchId: batch!.id,
        externalId: '0000-000102',
        paidAt: new Date('2026-06-02T00:00:00.000Z'),
        amount: 5000,
        isRefund: false,
        purpose: 'Оплата по счету № IT-2',
        accountCandidates: [],
        rawRow: [],
        status: 'needs_review',
      },
      select: { id: true },
    });
    await prisma.payment.deleteMany({ where: { externalId: '0000-000102' } });
    const res = await resolveQueueRow(prisma, adminSession, {
      rowId: row.id,
      organizationId: orgId,
      orderId: null,
    });
    expect(res.ok).toBe(true);
    const pay = await prisma.payment.findUnique({ where: { externalId: '0000-000102' } });
    expect(pay?.organizationId).toBe(orgId);
    const updated = await prisma.paymentImportRow.findUnique({
      where: { externalId: '0000-000102' },
    });
    expect(updated?.status).toBe('resolved');
  });
});
