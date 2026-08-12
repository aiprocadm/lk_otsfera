import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';

import {
  commitPaymentImport,
  previewPaymentImport,
} from '@/lib/services/import/oneCAccountCard/import-batch';
import { planImportRollback, rollbackImport } from '@/lib/services/import/rollback';
import { listExchangeHistory } from '@/lib/services/import/history';
import { getAutoCreatedFrom1C } from '@/lib/services/organization/autoCreated';

/**
 * Этап 7, `У-59`: откат импорта выписки на живом Postgres.
 *
 * Юнит-тест проверяет, что движок ходит в правильные таблицы; здесь — что
 * данные действительно исчезают и возвращаются. Конфликты (акт комиссии,
 * чужие связи) — общий с Excel-каналом код, он покрыт
 * `import.stage9-rollback.integration`; дублировать сборку акта тут незачем.
 */
const prisma = new PrismaClient();
const STAMP = Date.now();
const INN = '7707083893'; // валидная контрольная сумма
const EXT_A = 'ST7-000001';
const EXT_B = 'ST7-000002';
const USER_ID = `st7-admin-${STAMP}`;

let companyId = '';
let orgId = '';
const session = { sub: USER_ID, role: 'admin', companyId: null } as never;

/** Карточка счёта 51 с двумя поступлениями от клиента с известным ИНН. */
async function card(amountA: string, amountB: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Лист1');
  ws.addRow(['Сальдо на начало']);
  for (const [ext, amount, day] of [
    [EXT_A, amountA, '01'],
    [EXT_B, amountB, '02'],
  ] as const) {
    ws.addRow([
      `${day}.07.2026`,
      `Поступление на расчетный счет ${ext} от ${day}.07.2026 10:00:00\nОплата по договору`,
      '',
      `КЛИЕНТ ООО ИНН ${INN}`,
      '',
      amount,
      '',
      '62.01',
      '',
    ]);
  }
  ws.addRow(['Обороты за период и сальдо на конец']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function commit(amountA: string, amountB: string): Promise<string> {
  const res = await commitPaymentImport(prisma, session, {
    fileBuffer: await card(amountA, amountB),
    fileName: `st7-${amountA}.xlsx`,
  });
  if (!res.ok) throw new Error(`commit failed: ${res.error}`);
  return res.result.batchId;
}

beforeAll(async () => {
  await prisma.user.create({
    data: { id: USER_ID, email: `${USER_ID}@t.test`, name: 'Stage7 Admin', role: 'admin' },
  });
  const company = await prisma.company.create({ data: { name: `Stage7 Co ${STAMP}` } });
  companyId = company.id;
  const org = await prisma.organization.create({
    data: { name: `Клиент ООО ${STAMP}`, inn: INN, companyId },
  });
  orgId = org.id;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { externalId: { in: [EXT_A, EXT_B] } } });
  await prisma.paymentImportRow.deleteMany({ where: { externalId: { in: [EXT_A, EXT_B] } } });
  await prisma.paymentImportBatch.deleteMany({ where: { importedById: USER_ID } });
  await prisma.auditLog.deleteMany({ where: { userId: USER_ID } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.$disconnect();
});

describe('этап 7 — откат импорта выписки (живой Postgres)', () => {
  it('импорт оставляет след записи: без него откатывать было бы нечего', async () => {
    const batchId = await commit('18000', '5000');
    const writes = await prisma.paymentImportWrite.findMany({ where: { batchId } });
    expect(writes).toHaveLength(2);
    expect(writes.every((w) => w.entity === 'payment' && w.action === 'created')).toBe(true);
    expect(await prisma.payment.count({ where: { externalId: { in: [EXT_A, EXT_B] } } })).toBe(2);

    // Кнопка отката в общей истории — настоящая, а не заглушка (`У-48`).
    const history = await listExchangeHistory(prisma, session, { channel: 'statement' });
    if (!history.ok) throw new Error('expected ok');
    expect(history.items.find((i) => i.id === batchId)?.rollback).toBe('available');

    const plan = await planImportRollback(prisma, session, { batchId, channel: 'statement' });
    expect(plan).toMatchObject({ ok: true, plan: { toDelete: { payments: 2 }, conflicts: [] } });

    const res = await rollbackImport(prisma, session, {
      batchId,
      partial: false,
      channel: 'statement',
    });
    expect(res).toMatchObject({ ok: true, status: 'rolled_back', deleted: { payments: 2 } });
    expect(await prisma.payment.count({ where: { externalId: { in: [EXT_A, EXT_B] } } })).toBe(0);

    const batch = await prisma.paymentImportBatch.findUnique({ where: { id: batchId } });
    expect(batch?.status).toBe('rolled_back');
    expect(batch?.rolledBackById).toBe(USER_ID);
    expect(batch?.rolledBackAt).toBeTruthy();

    // Повторный откат не удаляет ничего второй раз.
    expect(
      await rollbackImport(prisma, session, { batchId, partial: false, channel: 'statement' })
    ).toEqual({ ok: false, error: 'already_rolled_back' });

    // Аудит записан своим действием — иначе откат не отличить от Excel-ового.
    const audit = await prisma.auditLog.findFirst({
      where: { userId: USER_ID, action: 'payment_import.rollback' },
    });
    expect(audit?.entityId).toBe(batchId);
  });

  it('повторный импорт того же платежа откатывается восстановлением суммы, а не удалением', async () => {
    const first = await commit('18000', '5000');
    const second = await commit('19999', '5000');

    const writes = await prisma.paymentImportWrite.findMany({ where: { batchId: second } });
    expect(writes.every((w) => w.action === 'updated')).toBe(true);

    const res = await rollbackImport(prisma, session, {
      batchId: second,
      partial: false,
      channel: 'statement',
    });
    expect(res).toMatchObject({ ok: true, restored: 2, deleted: { payments: 0 } });

    const payment = await prisma.payment.findUnique({ where: { externalId: EXT_A } });
    expect(Number(payment?.amount)).toBe(18000);

    // Первый батч всё ещё откатывается — теперь уже с удалением.
    const back = await rollbackImport(prisma, session, {
      batchId: first,
      partial: false,
      channel: 'statement',
    });
    expect(back).toMatchObject({ ok: true, deleted: { payments: 2 } });
    expect(await prisma.payment.count({ where: { externalId: { in: [EXT_A, EXT_B] } } })).toBe(0);
  });

  it('батч, загруженный до появления следа, честно говорит «отменять нечего»', async () => {
    const legacy = await prisma.paymentImportBatch.create({
      data: {
        importedById: USER_ID,
        companyId,
        fileName: 'старая-выписка.xls',
        counts: {} as unknown as Prisma.InputJsonValue,
        status: 'committed',
      },
      select: { id: true },
    });
    expect(
      await planImportRollback(prisma, session, { batchId: legacy.id, channel: 'statement' })
    ).toEqual({ ok: false, error: 'nothing_to_revert' });

    const history = await listExchangeHistory(prisma, session, { channel: 'statement' });
    if (!history.ok) throw new Error('expected ok');
    expect(history.items.find((i) => i.id === legacy.id)?.rollback).toBe('nothing_to_revert');
  });
});

/**
 * `У-49`…`У-54` (PR-3): импорт заводит организацию сам — и её тоже можно
 * откатить. Это главная проверка этапа: раньше платёж от неизвестного
 * плательщика уходил в очередь, и организацию заводили руками.
 */
describe('этап 7 — автосоздание организации по ИНН (живой Postgres)', () => {
  const NEW_INN = '7736207543'; // валиден, организации с ним нет
  const EXT_C = 'ST7-000003';

  async function cardWithUnknownPayer(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Лист1');
    ws.addRow(['Сальдо на начало']);
    ws.addRow([
      '05.07.2026',
      `Поступление на расчетный счет ${EXT_C} от 05.07.2026 10:00:00\nОплата по счёту`,
      '',
      `НОВЫЙ КЛИЕНТ ООО ИНН ${NEW_INN}`,
      '',
      '7000',
      '',
      '62.01',
      '',
    ]);
    ws.addRow(['Обороты за период и сальдо на конец']);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { externalId: EXT_C } });
    await prisma.paymentImportRow.deleteMany({ where: { externalId: EXT_C } });
    await prisma.organization.deleteMany({ where: { inn: NEW_INN } });
  });

  it('предпросмотр обещает создание, импорт создаёт, платёж привязывается, откат убирает', async () => {
    const fileBuffer = await cardWithUnknownPayer();

    // `У-52`: список того, что будет создано, — ДО применения.
    const preview = await previewPaymentImport(prisma, session, {
      fileBuffer,
      fileName: 'новый-клиент.xlsx',
      companyId,
    });
    if (!preview.ok) throw new Error(`preview failed: ${preview.error}`);
    expect(preview.plan.newCounterparties).toEqual([
      { name: 'НОВЫЙ КЛИЕНТ ООО', inn: NEW_INN, rows: 1 },
    ]);

    const res = await commitPaymentImport(prisma, session, {
      fileBuffer,
      fileName: 'новый-клиент.xlsx',
      companyId,
    });
    if (!res.ok) throw new Error(`commit failed: ${res.error}`);
    expect(res.result.counts.orgsCreated).toBe(1);
    // Платёж не остался в очереди — ради этого всё и затевалось.
    expect(res.result.counts.imported).toBe(1);
    expect(res.result.counts.queued).toBe(0);

    const org = await prisma.organization.findFirst({ where: { inn: NEW_INN } });
    expect(org?.companyId).toBe(companyId);
    const payment = await prisma.payment.findUnique({ where: { externalId: EXT_C } });
    expect(payment?.organizationId).toBe(org?.id);

    // `У-54`: источник в аудите — по нему карточка рисует плашку.
    const mark = await getAutoCreatedFrom1C(prisma, org!.id);
    expect(mark?.fileName).toBe('новый-клиент.xlsx');

    // `У-59`: автосозданная организация удаляется откатом вместе с платежом.
    const back = await rollbackImport(prisma, session, {
      batchId: res.result.batchId,
      partial: false,
      channel: 'statement',
    });
    expect(back).toMatchObject({ ok: true, deleted: { organizations: 1, payments: 1 } });
    expect(await prisma.organization.count({ where: { inn: NEW_INN } })).toBe(0);
  });

  it('строка без ИНН и с кривым ИНН остаётся в очереди (`У-51`)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Лист1');
    ws.addRow(['Сальдо на начало']);
    ws.addRow([
      '06.07.2026',
      'Поступление на расчетный счет ST7-000004 от 06.07.2026 10:00:00\nОплата',
      '',
      'КОНТРАГЕНТ БЕЗ РЕКВИЗИТОВ ИНН 1234567890',
      '',
      '900',
      '',
      '62.01',
      '',
    ]);
    ws.addRow(['Обороты за период и сальдо на конец']);
    const res = await commitPaymentImport(prisma, session, {
      fileBuffer: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: 'кривой-инн.xlsx',
      companyId,
    });
    if (!res.ok) throw new Error(`commit failed: ${res.error}`);
    expect(res.result.counts.orgsCreated).toBe(0);
    expect(res.result.counts.queued).toBe(1);
    await prisma.paymentImportRow.deleteMany({ where: { externalId: 'ST7-000004' } });
  });
});
