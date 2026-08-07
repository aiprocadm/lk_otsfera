import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { commitImport } from '@/lib/services/import';
import {
  listImportBatches,
  planImportRollback,
  rollbackImport,
} from '@/lib/services/import/rollback';

/**
 * Этап 9 ТЗ починки импорта (Т-35…Т-40) на живом Postgres — сквозной путь:
 *  1) импорт v1 (created) → импорт v2 (updated со снимками) →
 *     откат v2 восстанавливает прежние значения; батч rolled_back, аудит есть;
 *  2) конфликт (пользователь организации): full → conflicts, ничего не тронуто;
 *     partial → платёж и заказ удалены, организация жива, rollback_partial;
 *  3) повторный откат partial-батча после ручного снятия конфликта добивает
 *     хвост (rolled_back, организация удалена);
 *  4) Т-40: батч старше 30 дней — expired, в списке кнопка неактивна.
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
const ORG_INN = makeInn10(`91${String(STAMP).slice(-7)}`);
const ORG_KEY = `1c-inn:${ORG_INN}`;
const ORDER_EXT = `st9-ord-${STAMP}`;
const PAY_EXT = `st9-pay-${STAMP}`;

let adminSession: never;
let adminUserId: string;
let orgUserId: string;
let companyId: string;

async function buildBook(v: {
  orgName: string;
  total: number;
  paid: number;
  amount: number;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const orgs = wb.addWorksheet('Контрагенты');
  orgs.addRow(['Наименование', 'ИНН', 'КПП', 'ИНН партнёра']);
  orgs.addRow([v.orgName, ORG_INN, '770901001', '']);
  const orders = wb.addWorksheet('Реализации');
  orders.addRow(['Номер', 'ИНН организации', 'Сумма', 'Оплачено']);
  orders.addRow([ORDER_EXT, ORG_INN, v.total, v.paid]);
  const payments = wb.addWorksheet('Поступления');
  payments.addRow(['Номер документа', 'ИНН', 'Сумма', 'Дата', 'Заказ']);
  payments.addRow([PAY_EXT, ORG_INN, v.amount, '2026-08-01T00:00:00Z', ORDER_EXT]);
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

async function commit(fileName: string, v: Parameters<typeof buildBook>[0]): Promise<string> {
  const res = await commitImport(prisma, adminSession, {
    fileBuffer: await buildBook(v),
    fileName,
    companyId,
  });
  expect(res.ok).toBe(true);
  const batch = await prisma.oneCImportBatch.findFirst({
    where: { importedById: adminUserId, fileName },
    select: { id: true },
  });
  expect(batch).not.toBeNull();
  return batch!.id;
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `Компания этапа 9 ${STAMP}` } });
  companyId = company.id;
  const admin = await prisma.user.create({
    data: {
      email: `st9-admin-${STAMP}@test.local`,
      name: 'Админ этапа 9',
      role: 'admin',
      passwordHash: 'x',
    },
  });
  adminUserId = admin.id;
  adminSession = { sub: admin.id, role: 'admin' } as never;
  const orgUser = await prisma.user.create({
    data: {
      email: `st9-org-${STAMP}@test.local`,
      name: 'Пользователь организации',
      role: 'organization',
      passwordHash: 'x',
    },
  });
  orgUserId = orgUser.id;
});

afterAll(async () => {
  await prisma.organizationUser.deleteMany({ where: { userId: orgUserId } });
  const org = await prisma.organization.findUnique({
    where: { externalId: ORG_KEY },
    select: { id: true },
  });
  if (org) {
    await prisma.payment.deleteMany({ where: { organizationId: org.id } });
    await prisma.order.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }
  await prisma.oneCImportBatch.deleteMany({ where: { importedById: adminUserId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, orgUserId] } } });
  await prisma.$disconnect();
});

describe('этап 9 — откат импорта (живой Postgres)', () => {
  let batchV1 = '';
  let batchV2 = '';

  it('откат updated-батча восстанавливает прежние значения из before', async () => {
    batchV1 = await commit('st9-v1.xlsx', {
      orgName: `ООО Этап 9 ${STAMP}`,
      total: 1000,
      paid: 0,
      amount: 300,
    });
    batchV2 = await commit('st9-v2.xlsx', {
      orgName: `ООО Этап 9 ПЕРЕИМЕНОВАНО ${STAMP}`,
      total: 2000,
      paid: 500,
      amount: 999,
    });

    const res = await rollbackImport(prisma, adminSession, { batchId: batchV2, partial: false });
    expect(res).toMatchObject({ ok: true, status: 'rolled_back', restored: 3 });

    const org = await prisma.organization.findUnique({
      where: { externalId: ORG_KEY },
      select: { name: true },
    });
    expect(org?.name).toBe(`ООО Этап 9 ${STAMP}`); // имя вернулось
    const order = await prisma.order.findFirst({
      where: { externalId: ORDER_EXT },
      select: { totalAmount: true, paidAmount: true },
    });
    expect(String(order?.totalAmount)).toBe('1000');
    expect(String(order?.paidAmount)).toBe('0');
    const pay = await prisma.payment.findUnique({
      where: { externalId: PAY_EXT },
      select: { amount: true },
    });
    expect(String(pay?.amount)).toBe('300');

    const batch = await prisma.oneCImportBatch.findUnique({
      where: { id: batchV2 },
      include: { rows: true },
    });
    expect(batch?.status).toBe('rolled_back');
    expect(batch?.rolledBackById).toBe(adminUserId);
    expect(batch?.rows.every((r) => r.reverted)).toBe(true);

    // Т-38: аудит отката записан.
    const audit = await prisma.auditLog.findFirst({
      where: { userId: adminUserId, action: 'one_c_import.rollback', entityId: batchV2 },
    });
    expect(audit).not.toBeNull();
  });

  it('конфликт: full → список и ни одной тронутой записи; partial → безопасные откачены (Т-36/Т-37)', async () => {
    // Пользователь организации — блокирующая связь из списка Т-36.
    const org = await prisma.organization.findUnique({
      where: { externalId: ORG_KEY },
      select: { id: true },
    });
    await prisma.organizationUser.create({
      data: { organizationId: org!.id, userId: orgUserId, roleInOrg: 'admin' },
    });

    const before = {
      orgs: await prisma.organization.count(),
      orders: await prisma.order.count(),
      payments: await prisma.payment.count(),
    };
    const full = await rollbackImport(prisma, adminSession, { batchId: batchV1, partial: false });
    expect(full.ok).toBe(false);
    if (full.ok) return;
    expect(full.error).toBe('conflicts');
    expect(full.conflicts?.some((c) => c.code === 'org_has_users')).toBe(true);
    expect({
      orgs: await prisma.organization.count(),
      orders: await prisma.order.count(),
      payments: await prisma.payment.count(),
    }).toEqual(before); // ничего не тронуто

    // План для диалога показывает те же конфликты.
    const plan = await planImportRollback(prisma, adminSession, { batchId: batchV1 });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.plan.conflicts.length).toBeGreaterThan(0);

    const partial = await rollbackImport(prisma, adminSession, { batchId: batchV1, partial: true });
    expect(partial).toMatchObject({
      ok: true,
      status: 'rollback_partial',
      deleted: { organizations: 0, orders: 1, payments: 1 },
    });
    expect(await prisma.order.findFirst({ where: { externalId: ORDER_EXT } })).toBeNull();
    expect(await prisma.payment.findUnique({ where: { externalId: PAY_EXT } })).toBeNull();
    expect(await prisma.organization.findUnique({ where: { externalId: ORG_KEY } })).not.toBeNull();
  });

  it('повторный откат partial-батча после снятия конфликта добивает хвост (§8.2 спеки)', async () => {
    await prisma.organizationUser.deleteMany({ where: { userId: orgUserId } });
    const res = await rollbackImport(prisma, adminSession, { batchId: batchV1, partial: false });
    expect(res).toMatchObject({
      ok: true,
      status: 'rolled_back',
      deleted: { organizations: 1, orders: 0, payments: 0 },
    });
    expect(await prisma.organization.findUnique({ where: { externalId: ORG_KEY } })).toBeNull();

    // Дважды откатить нельзя.
    expect(
      await rollbackImport(prisma, adminSession, { batchId: batchV1, partial: false })
    ).toEqual({ ok: false, error: 'already_rolled_back' });
  });

  it('Т-40: батч старше 30 дней — expired и в списке, и на попытке отката', async () => {
    await prisma.oneCImportBatch.update({
      where: { id: batchV2 },
      data: {
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        status: 'committed', // вернуть к откатываемому виду, чтобы сработал именно срок
      },
    });
    expect(
      await rollbackImport(prisma, adminSession, { batchId: batchV2, partial: false })
    ).toEqual({ ok: false, error: 'expired' });
    const list = await listImportBatches(prisma, adminSession);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.batches.find((b) => b.id === batchV2)?.rollback).toBe('expired');
  });
});
