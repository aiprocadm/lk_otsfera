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
  ws.addRow(['01.06.2026', 'Поступление на расчетный счет 0000-000101 от 01.06.2026 10:00:00\nОплата по счету № IT-1 В Т.Ч. НДС (5%) 100-00', '', 'ТЕСТ ОРГ ООО ИНН 7712345678', '', '21000', '', '62.01']);
  // несопоставимая (нет ИНН, неизвестное имя) → очередь
  ws.addRow(['02.06.2026', 'Поступление на расчетный счет 0000-000102 от 02.06.2026 10:00:00\nОплата по счету № IT-2', '', 'НЕИЗВЕСТНАЯ КОМПАНИЯ', '', '5000', '', '62.01']);
  // поставщик 60 → excluded
  ws.addRow(['03.06.2026', 'Списание с расчетного счета 0000-000103 от 03.06.2026 10:00:00\nоплата поставщику', '', 'ПОСТАВЩИК', '', '', '', '60', '900']);
  ws.addRow(['Обороты за период и сальдо на конец']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

let orgId = '';
beforeAll(async () => {
  // PaymentImportBatch.importedById has a real FK to User → session.sub must be a real user id.
  await prisma.user.create({ data: { id: 'admin-it', email: 'admin-it@card51.test', name: 'IT Admin', role: 'admin' } });
  const company = await prisma.company.create({ data: { name: 'IT Co' } });
  const org = await prisma.organization.create({ data: { name: 'ТЕСТ ОРГ ООО', inn: '7712345678', companyId: company.id } });
  orgId = org.id;
});
afterAll(async () => {
  await prisma.payment.deleteMany({ where: { externalId: { in: ['0000-000101', '0000-000102'] } } });
  await prisma.paymentImportRow.deleteMany({ where: { externalId: { in: ['0000-000101', '0000-000102'] } } });
  await prisma.paymentImportBatch.deleteMany({ where: { importedById: 'admin-it' } });
  await prisma.organization.deleteMany({ where: { inn: '7712345678' } });
  await prisma.company.deleteMany({ where: { name: 'IT Co' } });
  // commitPaymentImport writes audit logs keyed to session.sub → clear before deleting the user (FK).
  await prisma.auditLog.deleteMany({ where: { userId: 'admin-it' } });
  await prisma.user.deleteMany({ where: { id: 'admin-it' } });
  await prisma.$disconnect();
});

describe('card-51 import (integration)', () => {
  it('commits: INN-match → Payment, no-match → queue, supplier → excluded', async () => {
    const buf = await cardBuffer();
    const res = await commitPaymentImport(prisma, adminSession, { fileBuffer: buf, fileName: 'card.xlsx' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.counts.imported).toBe(1);
      expect(res.result.counts.queued).toBe(1);
      expect(res.result.counts.excluded).toBe(1);
    }
    const pay = await prisma.payment.findUnique({ where: { externalId: '0000-000101' } });
    expect(pay?.organizationId).toBe(orgId);
    expect(Number(pay?.vatAmount)).toBe(100);
    const queued = await prisma.paymentImportRow.findUnique({ where: { externalId: '0000-000102' } });
    expect(queued?.status).toBe('needs_review');
  });

  it('is idempotent: re-import creates no duplicates', async () => {
    const buf = await cardBuffer();
    await commitPaymentImport(prisma, adminSession, { fileBuffer: buf, fileName: 'card.xlsx' });
    const payCount = await prisma.payment.count({ where: { externalId: '0000-000101' } });
    const rowCount = await prisma.paymentImportRow.count({ where: { externalId: '0000-000102' } });
    expect(payCount).toBe(1);
    expect(rowCount).toBe(1);
  });

  it('resolveQueueRow promotes a queue row to Payment', async () => {
    const row = await prisma.paymentImportRow.findUnique({ where: { externalId: '0000-000102' } });
    const res = await resolveQueueRow(prisma, adminSession, { rowId: row!.id, organizationId: orgId, orderId: null });
    expect(res.ok).toBe(true);
    const pay = await prisma.payment.findUnique({ where: { externalId: '0000-000102' } });
    expect(pay?.organizationId).toBe(orgId);
    const updated = await prisma.paymentImportRow.findUnique({ where: { externalId: '0000-000102' } });
    expect(updated?.status).toBe('resolved');
  });
});
