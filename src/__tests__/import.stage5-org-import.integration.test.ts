import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { previewImport, commitImport } from '@/lib/services/import';

/**
 * Этап 5 ТЗ починки импорта — сквозной прогон ЯДРА на живом Postgres с
 * настоящей книгой (собирается ExcelJS прямо здесь, без бинарных фикстур):
 *  - критерий приёмки 1: полный файл с 3 листами в чистое состояние —
 *    организации создаются, заказ и оплата того же файла привязываются;
 *  - критерий 2 / Т-23: повторная загрузка — created: 0, updated: N, без P2002;
 *  - критерий 7 / Т-24: предпросмотр не меняет ни одной записи;
 *  - критерий 11 / Т-21: строка без ИНН — в таблицу ошибок с наименованием,
 *    батч продолжается.
 */
const prisma = new PrismaClient();
const STAMP = Date.now();

/** Валидный 10-значный ИНН из 9 базовых цифр: контрольная цифра считается честно. */
function makeInn10(seed9: string): string {
  const d = [...seed9].map(Number);
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const control = (w.reduce((acc, wi, i) => acc + wi * (d[i] ?? 0), 0) % 11) % 10;
  return seed9 + String(control);
}

const ORG_INN = makeInn10(`5${String(STAMP).slice(-8)}`);
const ORDER_EXT = `st5-ord-${STAMP}`;
const PAY_EXT = `st5-pay-${STAMP}`;
const NO_INN_NAME = `ООО Без ИНН ${STAMP}`;
const ORG_KEY = `1c-inn:${ORG_INN}`;

let adminSession: never;

async function buildBook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const orgs = wb.addWorksheet('Контрагенты');
  orgs.addRow(['Наименование', 'ИНН', 'КПП', 'ИНН партнёра']);
  orgs.addRow([`ООО Ядро ${STAMP}`, ORG_INN, '770701001', '']);
  orgs.addRow([NO_INN_NAME, '', '', '']); // критерий 11: строка без ИНН
  const orders = wb.addWorksheet('Реализации');
  orders.addRow(['Номер', 'ИНН организации', 'Сумма', 'Оплачено']);
  orders.addRow([ORDER_EXT, ORG_INN, 1000, 1000]);
  const payments = wb.addWorksheet('Поступления');
  payments.addRow(['Номер документа', 'ИНН', 'Сумма', 'Дата', 'Заказ']);
  payments.addRow([PAY_EXT, ORG_INN, 1000, '2026-08-01T00:00:00Z', ORDER_EXT]);
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

async function dbCounts() {
  const [orgs, orders, payments] = await Promise.all([
    prisma.organization.count(),
    prisma.order.count(),
    prisma.payment.count(),
  ]);
  return { orgs, orders, payments };
}

let book: Buffer;
let adminUserId: string;

beforeAll(async () => {
  book = await buildBook();
  // Настоящий пользователь: recordAudit пишет FK на User, фейковый sub дал бы
  // P2003 (и хоть аудит non-blocking, тест не должен жить на подавленной ошибке).
  const user = await prisma.user.create({
    data: {
      email: `st5-admin-${STAMP}@test.local`,
      name: 'Админ этапа 5',
      role: 'admin',
      passwordHash: 'x',
    },
  });
  adminUserId = user.id;
  adminSession = { sub: user.id, role: 'admin' } as never;
});

afterAll(async () => {
  // Снизу вверх: оплаты → заказы → организации → минтованные Company (до этапа 6).
  const org = await prisma.organization.findUnique({
    where: { externalId: ORG_KEY },
    select: { id: true, companyId: true },
  });
  if (org) {
    await prisma.payment.deleteMany({ where: { order: { organizationId: org.id } } });
    await prisma.order.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    if (org.companyId) {
      await prisma.company.deleteMany({ where: { id: org.companyId, users: { none: {} } } });
    }
  }
  await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('этап 5 — импорт организаций, сквозной прогон (живой Postgres)', () => {
  it('критерий 7 / Т-24: предпросмотр показывает план и не меняет НИ ОДНОЙ записи', async () => {
    const before = await dbCounts();
    const res = await previewImport(prisma, adminSession, {
      fileBuffer: book,
      fileName: 'st5.xlsx',
    });
    const after = await dbCounts();

    expect(res.ok).toBe(true);
    if (res.ok) {
      // Организация «создалась бы»; заказ и оплата в предпросмотре честно
      // отбиваются organization_not_found — записи организации ещё НЕТ в базе
      // (Т-17 обещает связку из того же файла именно в live-режиме).
      expect(res.report.orgs.created).toBe(1);
      expect(res.report.orders.skips[0]).toMatchObject({ reason: 'organization_not_found' });
      // Строка без ИНН — в таблице ошибок с наименованием (критерий 11).
      expect(res.report.orgs.invalid).toBe(1);
      expect(res.report.orgs.invalids[0]).toMatchObject({
        externalId: NO_INN_NAME,
        issue: 'no_inn',
      });
    }
    // Снимок счётчиков не сдвинулся — включая backfill externalId (Т-24).
    expect(after).toEqual(before);
  });

  it('критерий 1: полный файл в чистое состояние — организация, затем её заказ и оплата', async () => {
    const res = await commitImport(prisma, adminSession, {
      fileBuffer: book,
      fileName: 'st5.xlsx',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.orgs.created).toBe(1);
    expect(res.report.orders.created).toBe(1);
    expect(res.report.payments.created).toBe(1);

    const org = await prisma.organization.findUnique({
      where: { externalId: ORG_KEY },
      select: { id: true, inn: true, kpp: true, partnerId: true },
    });
    expect(org).not.toBeNull();
    expect(org?.inn).toBe(ORG_INN);
    expect(org?.kpp).toBe('770701001');
    expect(org?.partnerId).toBeNull(); // прямой клиент (этап 4)

    // Заказ из того же файла привязался к свежесозданной организации (Т-17).
    const order = await prisma.order.findFirst({
      where: { externalId: ORDER_EXT },
      select: { id: true, organizationId: true },
    });
    expect(order?.organizationId).toBe(org?.id);

    const payment = await prisma.payment.findFirst({
      where: { externalId: PAY_EXT },
      select: { orderId: true },
    });
    expect(payment?.orderId).toBe(order?.id);
  });

  it('критерий 2 / Т-23: повторная загрузка того же файла — создано 0, обновлено N, без P2002', async () => {
    const res = await commitImport(prisma, adminSession, {
      fileBuffer: book,
      fileName: 'st5.xlsx',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.report.orgs.created).toBe(0);
    expect(res.report.orgs.updated).toBe(1);
    expect(res.report.orders.created).toBe(0);
    expect(res.report.payments.created).toBe(0);
    expect(res.report.orgs.failed).toBe(0);
  });
});
