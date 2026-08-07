import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { commitPaymentImport } from '@/lib/services/import/oneCAccountCard/import-batch';
import { createOrgFromQueueRow } from '@/lib/services/import/oneCAccountCard/create-org';

/**
 * Этап 10 ТЗ починки импорта (Т-30/Т-30а) на живом Postgres — сквозной путь:
 *  - Т-30а (страж): выписка с НОВЫМ валидным ИНН → строки в очередь,
 *    `organization.count()` не меняется — автосоздание запрещено;
 *  - Т-30: создание из очереди по кнопке — организация в выбранной компании,
 *    платёж создан и привязан, строка resolved, аудит записан;
 *  - повторная строка с тем же ИНН → org_exists (молчаливой привязки нет).
 */
const prisma = new PrismaClient();
const STAMP = Date.now();

function makeInn10(seed9: string): string {
  const d = [...seed9].map(Number);
  const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const control = (w.reduce((acc, wi, i) => acc + wi * (d[i] ?? 0), 0) % 11) % 10;
  return seed9 + String(control);
}

// ИНН-сиды: уникальный двузначный префикс одинаковой длины (грабля этапа 7).
const NEW_INN = makeInn10(`95${String(STAMP).slice(-7)}`);
// Формат номера — под экстрактор `\d{2,}-\d{3,}` (≥3 цифр после дефиса).
const DOC1 = `${String(STAMP).slice(-6)}-101`;
const DOC2 = `${String(STAMP).slice(-6)}-102`;
const ORG_NAME = `НОВАЯ ФИРМА ООО ${STAMP}`;

let adminSession: never;
let adminUserId: string;
let companyId: string;

async function statementBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.addRow(['Сальдо на начало']);
  for (const doc of [DOC1, DOC2]) {
    ws.addRow([
      '01.08.2026',
      `Поступление на расчетный счет ${doc} от 01.08.2026 10:00:00\nОплата по счету № X-${doc}`,
      '',
      `${ORG_NAME} ИНН ${NEW_INN}`,
      '',
      '7000',
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
      email: `st10-admin-${STAMP}@test.local`,
      name: 'Админ этапа 10',
      role: 'admin',
      passwordHash: 'x',
    },
  });
  adminUserId = admin.id;
  adminSession = { sub: admin.id, role: 'admin', companyId: null } as never;
  const company = await prisma.company.create({ data: { name: `Компания этапа 10 ${STAMP}` } });
  companyId = company.id;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { externalId: { in: [DOC1, DOC2] } } });
  await prisma.paymentImportRow.deleteMany({ where: { externalId: { in: [DOC1, DOC2] } } });
  await prisma.paymentImportBatch.deleteMany({ where: { importedById: adminUserId } });
  await prisma.organization.deleteMany({ where: { inn: NEW_INN } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('этап 10 — создание организации из очереди (живой Postgres)', () => {
  let rowId1 = '';
  let rowId2 = '';

  it('Т-30а: новый ИНН уходит в очередь, ни одной организации не создано', async () => {
    const orgsBefore = await prisma.organization.count();
    const res = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: await statementBuffer(),
      fileName: 'st10.xlsx',
    });
    expect(res.ok).toBe(true);

    expect(await prisma.organization.count()).toBe(orgsBefore); // страж Т-30а

    const rows = await prisma.paymentImportRow.findMany({
      where: { externalId: { in: [DOC1, DOC2] } },
      orderBy: { externalId: 'asc' },
      select: { id: true, status: true, counterpartyInn: true, counterpartyName: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'needs_review')).toBe(true);
    expect(rows[0]?.counterpartyInn).toBe(NEW_INN);
    rowId1 = rows[0]!.id;
    rowId2 = rows[1]!.id;
  });

  it('Т-30: создание по кнопке — организация в компании, платёж привязан, строка resolved, аудит есть', async () => {
    const res = await createOrgFromQueueRow(prisma, adminSession, {
      rowId: rowId1,
      name: ORG_NAME,
      inn: NEW_INN,
      kpp: '771001001',
      companyId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const org = await prisma.organization.findFirst({
      where: { inn: NEW_INN },
      select: { id: true, name: true, kpp: true, companyId: true, externalId: true },
    });
    expect(org?.id).toBe(res.organizationId);
    expect(org?.companyId).toBe(companyId);
    expect(org?.kpp).toBe('771001001');
    expect(org?.externalId).toBeNull(); // ключ 1c-inn: допишет файловый импорт (§8.4 спеки)

    const payment = await prisma.payment.findUnique({
      where: { externalId: DOC1 },
      select: { id: true, organizationId: true },
    });
    expect(payment?.organizationId).toBe(org?.id);
    expect(res.paymentId).toBe(payment?.id);

    const row = await prisma.paymentImportRow.findUnique({
      where: { id: rowId1 },
      select: { status: true },
    });
    expect(row?.status).toBe('resolved');

    const audit = await prisma.auditLog.findFirst({
      where: { userId: adminUserId, action: 'organization_created_manual', entityId: org!.id },
    });
    expect(audit).not.toBeNull();
  });

  it('повторная строка с тем же ИНН → org_exists, вторая организация не создаётся (§8.2 спеки)', async () => {
    const orgsBefore = await prisma.organization.count();
    const res = await createOrgFromQueueRow(prisma, adminSession, {
      rowId: rowId2,
      name: ORG_NAME,
      inn: NEW_INN,
      companyId,
    });
    expect(res).toEqual({ ok: false, error: 'org_exists' });
    expect(await prisma.organization.count()).toBe(orgsBefore);
    const row = await prisma.paymentImportRow.findUnique({
      where: { id: rowId2 },
      select: { status: true },
    });
    expect(row?.status).toBe('needs_review'); // строка жива для штатной «Привязать»
  });
});
