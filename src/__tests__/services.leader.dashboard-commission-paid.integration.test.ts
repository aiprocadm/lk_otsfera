import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { leaderDashboard } from '@/lib/services/leader/dashboard';
import { moscowMonthRange } from '@/lib/dates/calendar';
import { parseKpiMonth } from '@/lib/kpi/period';

/**
 * `У-345` (ТЗ 28.10.2026): плитка «Комиссия посредников» на главной
 * руководителя — «выплачено в этом месяце». У ведомости нет компании
 * (посредник работает с организациями разных компаний), поэтому сумма
 * собирается по строкам — через заказ или платёж строки — и чужая компания
 * в ту же ведомость не попадает в сумму руководителя (C8).
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string, companyB: string, partnerId: string;
const statementIds: string[] = [];

function leader(companyId: string): SessionPayload {
  return { sub: `leader-${STAMP}`, role: 'leader', companyId } as unknown as SessionPayload;
}

async function orderIn(companyId: string, tag: string) {
  const org = await prisma.organization.create({
    data: { name: `ldrComm-${tag}-${STAMP}`, partnerId, companyId },
  });
  const order = await prisma.order.create({
    data: {
      title: `ldrComm-${tag}-${STAMP}`,
      companyId,
      organizationId: org.id,
      partnerId,
      totalAmount: 10000,
    },
  });
  const payment = await prisma.payment.create({
    data: { organizationId: org.id, orderId: order.id, amount: 10000, paidAt: new Date() },
  });
  return { orderId: order.id, paymentId: payment.id };
}

async function statement(
  status: 'paid' | 'approved' | 'superseded',
  paidAt: Date | null,
  items: Array<{ orderId?: string; paymentId?: string; amount: string }>
) {
  const s = await prisma.commissionStatement.create({
    data: {
      partnerId,
      // у посредника одна живая ведомость на период (частичный unique) — периоды разные
      periodFrom: new Date(Date.UTC(2025, statementIds.length, 1)),
      periodTo: new Date(Date.UTC(2025, statementIds.length, 28)),
      status,
      paidAt,
      items: {
        create: items.map((i) => ({
          ...(i.orderId ? { orderId: i.orderId } : {}),
          ...(i.paymentId ? { paymentId: i.paymentId } : {}),
          organizationName: 'x',
          baseAmount: 1000,
          rate: 0.1,
          commissionAmount: new Prisma.Decimal(i.amount),
        })),
      },
    },
  });
  statementIds.push(s.id);
}

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `ldrComm-A-${STAMP}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `ldrComm-B-${STAMP}` } })).id;
  partnerId = (
    await prisma.partner.create({
      data: { name: `ldrComm-P-${STAMP}`, commissionRate: new Prisma.Decimal('0.1') },
    })
  ).id;
  const a1 = await orderIn(companyA, 'a1');
  const a2 = await orderIn(companyA, 'a2');
  const b1 = await orderIn(companyB, 'b1');

  const { year, month } = parseKpiMonth(undefined);
  const { from } = moscowMonthRange(year, month);
  const inMonth = new Date(from.getTime() + 60 * 60 * 1000);
  const lastMonth = new Date(from.getTime() - 24 * 60 * 60 * 1000);

  // Оплачена в этом месяце: строка компании A по заказу, строка A через платёж,
  // строка компании B — в ТОЙ ЖЕ ведомости.
  await statement('paid', inMonth, [
    { orderId: a1.orderId, amount: '100.00' },
    { paymentId: a2.paymentId, amount: '25.50' },
    { orderId: b1.orderId, amount: '999.00' },
  ]);
  // Утверждена, но не оплачена — не выплачено.
  await statement('approved', null, [{ orderId: a1.orderId, amount: '50.00' }]);
  // Пересчитана (заменена новой) с датой выплаты в этом месяце — не считается:
  // иначе выплата посчиталась бы дважды, вместе с заменившей ведомостью.
  await statement('superseded', inMonth, [{ orderId: a1.orderId, amount: '40.00' }]);
  // Оплачена в прошлом месяце — не этот месяц.
  await statement('paid', lastMonth, [{ orderId: a2.orderId, amount: '70.00' }]);
});

afterAll(async () => {
  await prisma.commissionStatementItem.deleteMany({
    where: { statementId: { in: statementIds } },
  });
  await prisma.commissionStatement.deleteMany({ where: { id: { in: statementIds } } });
  await prisma.payment.deleteMany({
    where: { order: { companyId: { in: [companyA, companyB] } } },
  });
  await prisma.order.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
  await prisma.organization.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('главная руководителя — выплаченная комиссия за месяц (У-345)', () => {
  it('компания A: только оплаченные в этом месяце строки своей компании', async () => {
    const res = await leaderDashboard(prisma, leader(companyA));
    expect(res.kpis.commissionPaidThisMonth).toBe('125.50');
    // «Оплачено по команде» — две оплаты по 10 000 этого месяца
    expect(res.kpis.paidThisMonth).toBe('20000.00');
  });

  it('компания B видит свою строку той же ведомости и не видит строк A', async () => {
    const res = await leaderDashboard(prisma, leader(companyB));
    expect(res.kpis.commissionPaidThisMonth).toBe('999.00');
    expect(res.kpis.paidThisMonth).toBe('10000.00');
  });
});
