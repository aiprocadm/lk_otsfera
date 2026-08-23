import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { commitPaymentImport } from '@/lib/services/import/oneCAccountCard/import-batch';
import { createOrgFromQueueRow } from '@/lib/services/import/oneCAccountCard/create-org';

/**
 * Этап 10 ТЗ починки импорта (Т-30) на живом Postgres + `У-55` этапа 7.
 *
 * **Страж Т-30а переписан, а не «починен»:** он утверждал, что новый валидный
 * ИНН НЕ должен порождать организацию (решение владельца №5). Решение `Р-2`
 * действующего ТЗ это отменило — теперь проверяем новое правило: валидный ИНН
 * заводит организацию сам (`У-49`).
 *
 * **Ручной путь тоже сузился (`У-86`, решение `Р-11`):** кривой или пустой ИНН
 * больше не отправляет строку в очередь — контрагента опознаёт название. В
 * очередь попадает только строка, у которой нет НИ названия, НИ ИНН, — её-то
 * оператор и разбирает диалогом «создать организацию».
 *
 * Сквозной путь:
 *  - `У-49`: выписка с новым валидным ИНН → организация создана, платежи
 *    привязаны, в очереди пусто;
 *  - Т-30: создание из очереди по кнопке (строка без реквизитов вовсе) —
 *    организация в выбранной компании, платёж привязан, строка resolved,
 *    аудит записан;
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
const DOC3 = `${String(STAMP).slice(-6)}-103`;
const DOC4 = `${String(STAMP).slice(-6)}-104`;
const ORG_NAME = `НОВАЯ ФИРМА ООО ${STAMP}`;
// Ручной путь заводит СВОЮ организацию: название и ИНН оператор вписывает в диалоге.
const MANUAL_INN = makeInn10(`96${String(STAMP).slice(-7)}`);

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

/**
 * Выписка, у строк которой контрагент не указан вовсе (пустая аналитика).
 * `У-86`: только такие строки теперь уходят в очередь — заводить организацию
 * не из чего, ни названия, ни ИНН. Это и есть материал для ручного разбора.
 */
async function statementWithoutCounterparty(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.addRow(['Сальдо на начало']);
  for (const doc of [DOC3, DOC4]) {
    ws.addRow([
      '02.08.2026',
      `Поступление на расчетный счет ${doc} от 02.08.2026 10:00:00\nОплата по счету № X-${doc}`,
      '',
      '',
      '',
      '4000',
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
  await prisma.payment.deleteMany({ where: { externalId: { in: [DOC1, DOC2, DOC3, DOC4] } } });
  await prisma.paymentImportRow.deleteMany({
    where: { externalId: { in: [DOC1, DOC2, DOC3, DOC4] } },
  });
  await prisma.paymentImportBatch.deleteMany({ where: { importedById: adminUserId } });
  await prisma.organization.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.auditLog.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('этап 10 — создание организации из очереди (живой Postgres)', () => {
  let rowId1 = '';
  let rowId2 = '';

  it('У-55 (бывший Т-30а): новый валидный ИНН — организация создаётся импортом', async () => {
    const res = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: await statementBuffer(),
      fileName: 'st10.xlsx',
      companyId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.counts.orgsCreated).toBe(1);

    const org = await prisma.organization.findFirst({ where: { inn: NEW_INN } });
    expect(org?.companyId).toBe(companyId);
    // Обе оплаты привязались к новой организации — в очередь не ушло ничего.
    const payments = await prisma.payment.findMany({
      where: { externalId: { in: [DOC1, DOC2] } },
      select: { organizationId: true },
    });
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.organizationId === org?.id)).toBe(true);
    expect(
      await prisma.paymentImportRow.count({ where: { externalId: { in: [DOC1, DOC2] } } })
    ).toBe(0);

    // Организацию завёл импорт — и это видно из журнала (`У-54`).
    const audit = await prisma.auditLog.findFirst({
      where: { userId: adminUserId, action: 'organization_created_auto', entityId: org!.id },
    });
    expect(audit).not.toBeNull();

    // Ручной путь дальше проверяем на строках, которые остались в очереди по
    // `У-51` в его нынешнем виде (`У-86`, `Р-11`): контрагента в файле нет
    // вовсе, поэтому создавать организацию не из чего.
    const bad = await commitPaymentImport(prisma, adminSession, {
      fileBuffer: await statementWithoutCounterparty(),
      fileName: 'st10-bad.xlsx',
      companyId,
    });
    expect(bad.ok).toBe(true);
    if (bad.ok) {
      expect(bad.result.counts.orgsCreated).toBe(0);
      expect(bad.result.counts.queued).toBe(2);
    }
    const rows = await prisma.paymentImportRow.findMany({
      where: { externalId: { in: [DOC3, DOC4] } },
      orderBy: { externalId: 'asc' },
      select: { id: true, status: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'needs_review')).toBe(true);
    rowId1 = rows[0]!.id;
    rowId2 = rows[1]!.id;
  });

  it('Т-30: создание по кнопке — организация в компании, платёж привязан, строка resolved, аудит есть', async () => {
    const res = await createOrgFromQueueRow(prisma, adminSession, {
      rowId: rowId1,
      name: `${ORG_NAME} (вручную)`,
      inn: MANUAL_INN,
      kpp: '771001001',
      companyId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const org = await prisma.organization.findFirst({
      where: { inn: MANUAL_INN },
      select: { id: true, name: true, kpp: true, companyId: true, externalId: true },
    });
    expect(org?.id).toBe(res.organizationId);
    expect(org?.companyId).toBe(companyId);
    expect(org?.kpp).toBe('771001001');
    expect(org?.externalId).toBeNull(); // ключ 1c-inn: допишет файловый импорт (§8.4 спеки)

    const payment = await prisma.payment.findUnique({
      where: { externalId: DOC3 },
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
      name: `${ORG_NAME} (вручную)`,
      inn: MANUAL_INN,
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
