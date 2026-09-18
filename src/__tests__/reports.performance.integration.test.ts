import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getReceivables } from '@/lib/services/leader/receivables';
import { getSources } from '@/lib/services/leader/sources';
import { kpiMetric } from '@/lib/kpi/metrics';

/**
 * Замер производительности отчётов (`У-248`, этап 7) на ЖИВОЙ базе.
 *
 * Требование: отчёт за месяц на ста тысячах заказов укладывается в две
 * секунды. Страж `reports.no-n-plus-one` ловит выборку в цикле по тексту, но
 * текст не видит всего — эта проверка меряет то, что происходит на самом деле.
 *
 * Если бюджет не выдержан, решение `Р-Э7-4` велит вернуться к заказчику с
 * цифрами, а не денормализовать схему вслепую.
 */
let prisma: PrismaClient;
const STAMP = Date.now();
const ORDERS = 100_000;
const BUDGET_MS = 2000;

let companyId = '';
let orgId = '';

beforeAll(async () => {
  prisma = new PrismaClient();
  const company = await prisma.company.create({ data: { name: `perfCo-${STAMP}` } });
  companyId = company.id;
  const org = await prisma.organization.create({
    data: { name: `perfOrg-${STAMP}`, companyId },
  });
  orgId = org.id;

  // Сто тысяч заказов пачками: одна вставка на всё уронила бы соединение.
  const CHUNK = 5_000;
  const base = new Date('2026-09-10T00:00:00Z');
  for (let offset = 0; offset < ORDERS; offset += CHUNK) {
    await prisma.order.createMany({
      data: Array.from({ length: CHUNK }, (_, i) => ({
        title: `perf-${STAMP}-${offset + i}`,
        organizationId: orgId,
        companyId,
        executionStatus: 'in_progress' as const,
        // Половина заказов — с долгом: иначе отчёт считает пустоту и меряет не то.
        financialStatus: (offset + i) % 2 === 0 ? ('billed' as const) : ('paid' as const),
        totalAmount: 1000,
        paidAmount: 0,
        createdAt: base,
      })),
      skipDuplicates: true,
    });
  }
}, 600_000);

afterAll(async () => {
  await prisma.order.deleteMany({ where: { companyId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
}, 600_000);

describe('производительность отчётов на 100 000 заказов (У-248)', () => {
  it('дебиторка укладывается в две секунды', async () => {
    const started = Date.now();
    const res = await getReceivables(prisma, { companyId });
    const elapsed = Date.now() - started;
    // Половина заказов с долгом по 1000 ₽ — отчёт считает реальные данные.
    expect(res.rows).toHaveLength(1);
    expect(Number(res.totalDebt)).toBe((ORDERS / 2) * 1000);
    expect(elapsed, `дебиторка заняла ${elapsed} мс при бюджете ${BUDGET_MS}`).toBeLessThan(
      BUDGET_MS
    );
  }, 60_000);

  it('показатель «заказы заведены» укладывается в две секунды', async () => {
    const from = new Date('2026-09-01T00:00:00Z');
    const to = new Date('2026-10-01T00:00:00Z');
    const started = Date.now();
    const fact = await kpiMetric('orders_created').compute(prisma, { companyId, from, to });
    const elapsed = Date.now() - started;
    expect(Number(fact.total)).toBe(ORDERS);
    expect(elapsed, `показатель занял ${elapsed} мс при бюджете ${BUDGET_MS}`).toBeLessThan(
      BUDGET_MS
    );
  }, 60_000);

  it('отчёт по источникам укладывается в две секунды', async () => {
    const from = new Date('2026-09-01T00:00:00Z');
    const to = new Date('2026-10-01T00:00:00Z');
    const started = Date.now();
    await getSources(prisma, { companyId, from, to });
    const elapsed = Date.now() - started;
    expect(elapsed, `источники заняли ${elapsed} мс при бюджете ${BUDGET_MS}`).toBeLessThan(
      BUDGET_MS
    );
  }, 60_000);
});
