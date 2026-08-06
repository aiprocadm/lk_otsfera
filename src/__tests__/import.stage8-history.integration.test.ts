import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { previewImport, commitImport } from '@/lib/services/import';

/**
 * Этап 8 ТЗ починки импорта (Т-32/Т-33/Т-34) на живом Postgres:
 *  - commitImport пишет OneCImportBatch (кто/файл/счётчики/статус) и строки
 *    `created` для организации, заказа и оплаты из одного файла;
 *  - повторный прогон пишет ВТОРОЙ батч со строками `updated` и снимками
 *    `before` строго по списку Т-33;
 *  - предпросмотр историю не ведёт;
 *  - удаление батча каскадом удаляет строки (onDelete: Cascade).
 */
const prisma = new PrismaClient();
const STAMP = Date.now();

function makeInn10(seed9: string): string {
  const d = [...seed9].map(Number);
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const control = (w.reduce((acc, wi, i) => acc + wi * (d[i] ?? 0), 0) % 11) % 10;
  return seed9 + String(control);
}

// ИНН-сиды: одинаковая длина, уникальный двузначный префикс (грабля этапа 7).
const ORG_INN = makeInn10(`81${String(STAMP).slice(-7)}`);
const ORG_KEY = `1c-inn:${ORG_INN}`;
const ORDER_EXT = `st8-ord-${STAMP}`;
const PAY_EXT = `st8-pay-${STAMP}`;

let adminSession: never;
let adminUserId: string;
let companyId: string;
let book: Buffer;

async function buildBook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const orgs = wb.addWorksheet('Контрагенты');
  orgs.addRow(['Наименование', 'ИНН', 'КПП', 'ИНН партнёра']);
  orgs.addRow([`ООО Этап 8 ${STAMP}`, ORG_INN, '770801001', '']);
  const orders = wb.addWorksheet('Реализации');
  orders.addRow(['Номер', 'ИНН организации', 'Сумма', 'Оплачено']);
  orders.addRow([ORDER_EXT, ORG_INN, 1500, 500]);
  const payments = wb.addWorksheet('Поступления');
  payments.addRow(['Номер документа', 'ИНН', 'Сумма', 'Дата', 'Заказ']);
  payments.addRow([PAY_EXT, ORG_INN, 500, '2026-08-01T00:00:00Z', ORDER_EXT]);
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `Компания этапа 8 ${STAMP}` } });
  companyId = company.id;
  const user = await prisma.user.create({
    data: {
      email: `st8-admin-${STAMP}@test.local`,
      name: 'Админ этапа 8',
      role: 'admin',
      passwordHash: 'x',
    },
  });
  adminUserId = user.id;
  adminSession = { sub: user.id, role: 'admin' } as never;
  book = await buildBook();
});

afterAll(async () => {
  await prisma.oneCImportBatch.deleteMany({ where: { importedById: adminUserId } });
  const org = await prisma.organization.findUnique({
    where: { externalId: ORG_KEY },
    select: { id: true },
  });
  if (org) {
    await prisma.payment.deleteMany({ where: { order: { organizationId: org.id } } });
    await prisma.order.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('этап 8 — история импорта (живой Postgres)', () => {
  it('предпросмотр историю не ведёт', async () => {
    const before = await prisma.oneCImportBatch.count();
    const res = await previewImport(prisma, adminSession, {
      fileBuffer: book,
      fileName: 'st8.xlsx',
      companyId,
    });
    expect(res.ok).toBe(true);
    expect(await prisma.oneCImportBatch.count()).toBe(before);
  });

  it('первый импорт: батч committed со строками created для трёх сущностей', async () => {
    const res = await commitImport(prisma, adminSession, {
      fileBuffer: book,
      fileName: 'st8.xlsx',
      companyId,
    });
    expect(res.ok).toBe(true);

    const batch = await prisma.oneCImportBatch.findFirst({
      where: { importedById: adminUserId },
      orderBy: { createdAt: 'desc' },
      include: { rows: true },
    });
    expect(batch).not.toBeNull();
    expect(batch?.companyId).toBe(companyId);
    expect(batch?.fileName).toBe('st8.xlsx');
    expect(batch?.status).toBe('committed');
    expect((batch?.counts as { orgs: { created: number } }).orgs.created).toBe(1);

    const byEntity = new Map(batch?.rows.map((r) => [r.entity, r]));
    expect(batch?.rows).toHaveLength(3);
    for (const entity of ['organization', 'order', 'payment'] as const) {
      const row = byEntity.get(entity);
      expect(row?.action).toBe('created');
      expect(row?.before).toBeNull();
      expect(row?.reverted).toBe(false);
    }
    // entityId — настоящие id созданных записей.
    const org = await prisma.organization.findUnique({
      where: { externalId: ORG_KEY },
      select: { id: true },
    });
    expect(byEntity.get('organization')?.entityId).toBe(org?.id);
  });

  it('повторный импорт: второй батч со строками updated и снимками before по списку Т-33', async () => {
    const res = await commitImport(prisma, adminSession, {
      fileBuffer: book,
      fileName: 'st8-again.xlsx',
      companyId,
    });
    expect(res.ok).toBe(true);

    const batch = await prisma.oneCImportBatch.findFirst({
      where: { importedById: adminUserId, fileName: 'st8-again.xlsx' },
      include: { rows: true },
    });
    expect(batch?.rows).toHaveLength(3);
    const byEntity = new Map(batch?.rows.map((r) => [r.entity, r]));

    const orgBefore = byEntity.get('organization')?.before as Record<string, unknown>;
    expect(byEntity.get('organization')?.action).toBe('updated');
    expect(Object.keys(orgBefore).sort()).toEqual([
      'externalId',
      'inn',
      'kpp',
      'name',
      'partnerId',
    ]);
    expect(orgBefore.inn).toBe(ORG_INN);

    const orderBefore = byEntity.get('order')?.before as Record<string, unknown>;
    expect(Object.keys(orderBefore).sort()).toEqual([
      'executionStatus',
      'financialStatus',
      'paidAmount',
      'totalAmount',
    ]);
    expect(orderBefore.totalAmount).toBe('1500');

    const payBefore = byEntity.get('payment')?.before as Record<string, unknown>;
    expect(Object.keys(payBefore).sort()).toEqual(['amount', 'paidAt', 'purpose']);
    expect(payBefore.amount).toBe('500');
  });

  it('удаление батча каскадом удаляет строки (Т-32, onDelete: Cascade)', async () => {
    const batch = await prisma.oneCImportBatch.findFirst({
      where: { importedById: adminUserId },
      select: { id: true, _count: { select: { rows: true } } },
    });
    expect(batch?._count.rows).toBeGreaterThan(0);
    await prisma.oneCImportBatch.delete({ where: { id: batch!.id } });
    expect(await prisma.oneCImportRow.count({ where: { batchId: batch!.id } })).toBe(0);
  });
});
