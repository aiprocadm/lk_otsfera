/**
 * `У-257` — ночная сверка дебиторки, целиком: процессор → сверка → строка в
 * истории обмена → отчёт Excel.
 *
 * Живая база нужна по существу: проверяется не «функция вызвалась», а что
 * расхождение действительно находится по данным заказа и что **суммы заказа
 * после сверки не изменились** (`Р-Э8-6`). На моках последнее доказать нельзя:
 * мок просто не имеет метода записи.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { syncReconcileDebtsProcessor } from '@/worker/processors/sync-reconcile-debts';
import { buildDebtsReport } from '@/lib/services/oneCSync/debtsReport';
import { countLastDebtMismatches } from '@/lib/services/oneCSync/debtMismatches';

let prisma: PrismaClient;
let companyId: string;
let orgId: string;
let orderId: string;

/** Фикстура мока 1С обещает по этому заказу долг 12 500. */
const FIXTURE_ORDER_EXTERNAL_ID = '1c-order-002';

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();

  const company = await prisma.company.create({ data: { name: `DebtCo-${stamp}` } });
  companyId = company.id;
  const org = await prisma.organization.create({
    data: { name: `DebtOrg-${stamp}`, companyId, inn: `77${String(stamp).slice(-8)}` },
  });
  orgId = org.id;

  // Долг кабинета = 100 000 − 40 000 = 60 000; 1С обещает 12 500 → расхождение.
  const order = await prisma.order.create({
    data: {
      title: `DebtOrder-${stamp}`,
      companyId,
      organizationId: orgId,
      externalId: FIXTURE_ORDER_EXTERNAL_ID,
      totalAmount: new Prisma.Decimal('100000'),
      paidAmount: new Prisma.Decimal('40000'),
      financialStatus: 'partially_paid',
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma.syncLog.deleteMany({ where: { entity: 'debt' } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('sync-reconcile-debts (У-257)', () => {
  it('находит расхождение, пишет строку в историю и НЕ трогает суммы заказа', async () => {
    const before = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { totalAmount: true, paidAmount: true, financialStatus: true },
    });

    const result = await syncReconcileDebtsProcessor({} as Job);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mine = result.mismatches.find((m) => m.orderId === orderId);
    expect(mine, 'расхождение по подготовленному заказу не найдено').toBeTruthy();
    expect(mine?.ours).toBe('60000.00');
    expect(mine?.theirs).toBe('12500.00');
    expect(mine?.diff).toBe('47500.00');

    // Главный инвариант `Р-Э8-6`: сверка только показывает.
    const after = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { totalAmount: true, paidAmount: true, financialStatus: true },
    });
    expect(after.totalAmount.toFixed(2)).toBe(before.totalAmount.toFixed(2));
    expect(after.paidAmount.toFixed(2)).toBe(before.paidAmount.toFixed(2));
    expect(after.financialStatus).toBe(before.financialStatus);

    // Строка в «Истории» обмена — канал «Дебиторка».
    const row = await prisma.syncLog.findFirst({
      where: { entity: 'debt', operation: 'reconcile' },
      orderBy: { createdAt: 'desc' },
      select: { status: true, errorMessage: true },
    });
    expect(row?.status).toBe('warn');
    expect(row?.errorMessage).toContain('Расхождения по дебиторке');
  });

  it('оповещение считает расхождения ПОСЛЕДНЕЙ сверки', async () => {
    const count = await countLastDebtMismatches(prisma);
    expect(count).toBeGreaterThan(0);
  });

  it('отчёт Excel собирается из той же записи, что показана в истории', async () => {
    const report = await buildDebtsReport(prisma);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.mismatches).toBeGreaterThan(0);
    expect(report.fileName).toMatch(/^Расхождения по дебиторке \d{4}-\d{2}-\d{2}\.xlsx$/);
    // XLSX — это ZIP: первые два байта «PK».
    expect(report.buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('чужая запись журнала отчётом не становится', async () => {
    const alien = await prisma.syncLog.create({
      data: {
        entity: 'order',
        externalId: null,
        direction: 'inbound',
        operation: 'pull',
        status: 'success',
      },
    });
    const report = await buildDebtsReport(prisma, { logId: alien.id });
    expect(report).toEqual({ ok: false, error: 'not_found' });
    await prisma.syncLog.delete({ where: { id: alien.id } });
  });
});
