import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';
import { setOrgCommissionRate, clearOrgCommissionRate } from '@/lib/services/partner/rateOverride';

/**
 * F4 (§16, A5) — история индивидуальной ставки организации.
 *
 * 1. setOrgCommissionRate / clearOrgCommissionRate пишут append-only строки
 *    OrganizationCommissionRateChange внутри своей транзакции.
 * 2. Расчёт ведомости берёт override, действовавший на paidAt, а НЕ текущее
 *    значение — изменение договорной ставки задним числом не переписывает
 *    прошлый период (воспроизводимость).
 * 3. Организации без истории (не тронутые после F4) считаются по текущему
 *    значению — поведение до F4 сохранено.
 */

let prisma: PrismaClient;
let partnerId: string;
let companyId: string;
let orgId: string;
let userId: string;

const PERIOD_FROM = new Date('2026-04-01T00:00:00Z');
const PERIOD_TO = new Date('2026-04-30T23:59:59Z');

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({
    data: { name: 'F4P-' + Date.now(), commissionRate: 0.1 }
  });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'F4C-' + Date.now() } });
  companyId = c.id;
  const org = await prisma.organization.create({
    data: { name: 'F4Org-' + Date.now(), partnerId, companyId }
  });
  orgId = org.id;
  const u = await prisma.user.create({
    data: { email: 'f4-' + Date.now() + '@x.local', passwordHash: 'h', name: 'U', role: 'partner', partnerId }
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.commissionRateChange.deleteMany({ where: { partnerId } });
  await prisma.organizationCommissionRateChange.deleteMany({ where: { organizationId: orgId } });
  await prisma.payment.deleteMany({ where: { organizationId: orgId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.payment.deleteMany({ where: { organizationId: orgId } });
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organizationCommissionRateChange.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.update({ where: { id: orgId }, data: { partnerCommissionRate: null } });
});

async function payInApril(amount: number) {
  const o = await prisma.order.create({
    data: { title: 'F4', companyId, organizationId: orgId, partnerId, totalAmount: amount, financialStatus: 'paid' }
  });
  await prisma.payment.create({
    data: { organizationId: orgId, orderId: o.id, amount, paidAt: new Date('2026-04-10') }
  });
}

async function calcApril() {
  const r = await calculateStatementForPartner(prisma, {
    partnerId, periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null
  });
  if (!r.ok) throw new Error(`unexpected calc failure: ${r.error}`);
  return r;
}

describe('F4 — rate mutations append history', () => {
  it('set → set → clear leaves a 3-row append-only timeline', async () => {
    await setOrgCommissionRate(prisma, { organizationId: orgId, partnerId, newRate: 0.07, reason: 'VIP', changedByUserId: userId });
    await setOrgCommissionRate(prisma, { organizationId: orgId, partnerId, newRate: 0.05, reason: 'renegotiated', changedByUserId: userId });
    await clearOrgCommissionRate(prisma, { organizationId: orgId, partnerId, reason: 'reset', changedByUserId: userId });

    const rows = await prisma.organizationCommissionRateChange.findMany({
      where: { organizationId: orgId },
      orderBy: { effectiveFrom: 'asc' }
    });
    expect(rows).toHaveLength(3);
    expect(rows[0].oldRate).toBeNull();
    expect(Number(rows[0].newRate)).toBe(0.07);
    expect(Number(rows[1].oldRate)).toBe(0.07);
    expect(Number(rows[1].newRate)).toBe(0.05);
    expect(Number(rows[2].oldRate)).toBe(0.05);
    expect(rows[2].newRate).toBeNull();
    expect(rows.every((r) => r.changedById === userId)).toBe(true);
  });
});

describe('F4 — statement uses the override in effect at paidAt', () => {
  it('retroactive change does not rewrite a past period', async () => {
    await payInApril(100000);
    // Таймлайн: 0.07 действовала весь апрель; 1 июня ставку сменили на 0.03
    // (текущее значение тоже 0.03). Пересчёт апреля обязан взять 0.07.
    await prisma.organizationCommissionRateChange.createMany({
      data: [
        { organizationId: orgId, oldRate: null, newRate: new Prisma.Decimal(0.07), effectiveFrom: new Date('2026-04-01'), changedById: userId },
        { organizationId: orgId, oldRate: new Prisma.Decimal(0.07), newRate: new Prisma.Decimal(0.03), effectiveFrom: new Date('2026-06-01'), changedById: userId }
      ]
    });
    await prisma.organization.update({ where: { id: orgId }, data: { partnerCommissionRate: 0.03 } });

    const r = await calcApril();
    expect(Number(r.statement.totalCommissionAmount)).toBe(7000); // 0.07, не 0.03 (=3000)
  });

  it('override introduced after the period → the period stays on partner level', async () => {
    await payInApril(100000);
    // В апреле override ещё не существовал (история началась 1 июня).
    await prisma.organizationCommissionRateChange.create({
      data: { organizationId: orgId, oldRate: null, newRate: new Prisma.Decimal(0.03), effectiveFrom: new Date('2026-06-01'), changedById: userId }
    });
    await prisma.organization.update({ where: { id: orgId }, data: { partnerCommissionRate: 0.03 } });

    const r = await calcApril();
    expect(Number(r.statement.totalCommissionAmount)).toBe(10000); // партнёрский дефолт 0.1
  });

  it('cleared before the period → partner level despite older override', async () => {
    await payInApril(100000);
    await prisma.organizationCommissionRateChange.createMany({
      data: [
        { organizationId: orgId, oldRate: null, newRate: new Prisma.Decimal(0.07), effectiveFrom: new Date('2026-01-01'), changedById: userId },
        { organizationId: orgId, oldRate: new Prisma.Decimal(0.07), newRate: null, effectiveFrom: new Date('2026-03-01'), changedById: userId }
      ]
    });

    const r = await calcApril();
    expect(Number(r.statement.totalCommissionAmount)).toBe(10000);
  });

  it('no history (pre-F4 org): current override applies as before', async () => {
    await payInApril(100000);
    await prisma.organization.update({ where: { id: orgId }, data: { partnerCommissionRate: 0.07 } });

    const r = await calcApril();
    expect(Number(r.statement.totalCommissionAmount)).toBe(7000);
  });
});
