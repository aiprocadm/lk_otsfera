import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';

import { commitPaymentImport } from '@/lib/services/import/oneCAccountCard/import-batch';
import { planImportRollback, rollbackImport } from '@/lib/services/import/rollback';
import { listExchangeHistory } from '@/lib/services/import/history';

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
