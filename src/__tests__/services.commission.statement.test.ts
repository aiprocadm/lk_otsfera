import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';

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
    data: { name: 'CommissionP-' + Date.now(), commissionRate: 0.1 },
  });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'CommissionC-' + Date.now() } });
  companyId = c.id;
  const org = await prisma.organization.create({
    data: { name: 'CommissionOrg-' + Date.now(), partnerId, companyId },
  });
  orgId = org.id;
  const u = await prisma.user.create({
    data: {
      email: 'commission-' + Date.now() + '@x.local',
      passwordHash: 'h',
      name: 'U',
      role: 'partner',
      partnerId,
    },
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.commissionStatementItem.deleteMany({
    where: { statement: { partnerId } },
  });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.commissionRateChange.deleteMany({ where: { partnerId } });
  await prisma.payment.deleteMany({ where: { order: { partnerId } } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partnerUser.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.payment.deleteMany({
    where: { OR: [{ order: { partnerId } }, { organizationId: orgId }] },
  });
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  // A2 isolation: reset the per-org override and partner rate history between cases.
  await prisma.commissionRateChange.deleteMany({ where: { partnerId } });
  await prisma.organization.update({ where: { id: orgId }, data: { partnerCommissionRate: null } });
});

async function createOrder(amount: number) {
  return prisma.order.create({
    data: {
      title: 'T',
      companyId,
      organizationId: orgId,
      partnerId,
      totalAmount: amount,
      financialStatus: 'paid',
    },
  });
}
async function pay(orderId: string | null, amount: number, paidAt: Date, isRefund = false) {
  return prisma.payment.create({
    data: { organizationId: orgId, orderId, amount, paidAt, isRefund },
  });
}
// Happy-path tests expect a successful Result; narrow once here so callers read fields directly.
async function calcOk(input: Parameters<typeof calculateStatementForPartner>[1]) {
  const r = await calculateStatementForPartner(prisma, input);
  if (!r.ok) throw new Error(`unexpected calc failure: ${r.error}`);
  return r;
}

describe('calculateStatementForPartner', () => {
  it('returns isNew=true with 0 items when no payments match period', async () => {
    const res = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: userId,
    });
    expect(res.isNew).toBe(true);
    expect(res.itemCount).toBe(0);
    expect(Number(res.statement.totalBaseAmount)).toBe(0);
    expect(Number(res.statement.totalCommissionAmount)).toBe(0);
    expect(res.statement.status).toBe('draft');
  });

  it('A1: base from actual payments, not order total', async () => {
    const o = await createOrder(100000);
    await pay(o.id, 40000, new Date('2026-04-10'));
    const r = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    expect(r.itemCount).toBe(1);
    expect(Number(r.statement.totalBaseAmount)).toBe(40000);
    expect(Number(r.statement.totalCommissionAmount)).toBe(4000);
  });

  it('A4: payment dated by paidAt, March payment excluded from April', async () => {
    const o = await createOrder(100000);
    await pay(o.id, 100000, new Date('2026-04-02'));
    const o2 = await createOrder(50000);
    await pay(o2.id, 50000, new Date('2026-03-31'));
    const r = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    expect(Number(r.statement.totalBaseAmount)).toBe(100000);
  });

  it('A1: order-less org-level payment attributed via organization.partnerId', async () => {
    await pay(null, 25000, new Date('2026-04-12'));
    const r = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    expect(r.itemCount).toBe(1);
    expect(Number(r.statement.totalBaseAmount)).toBe(25000);
  });

  it('A2: refund in period reduces the base', async () => {
    const o = await createOrder(100000);
    await pay(o.id, 100000, new Date('2026-04-05'));
    await pay(o.id, 30000, new Date('2026-04-20'), true);
    const r = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    expect(Number(r.statement.totalBaseAmount)).toBe(70000);
    expect(Number(r.statement.totalCommissionAmount)).toBe(7000);
  });

  it('re-calc on existing draft updates totals in place (isNew=false)', async () => {
    const o = await createOrder(100000);
    await pay(o.id, 100000, new Date('2026-04-10'));
    const first = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: userId,
    });
    expect(first.isNew).toBe(true);
    expect(Number(first.statement.totalBaseAmount)).toBe(100000);

    const o2 = await createOrder(50000);
    await pay(o2.id, 50000, new Date('2026-04-12'));
    const second = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: userId,
    });
    expect(second.isNew).toBe(false);
    expect(second.statement.id).toBe(first.statement.id);
    expect(second.itemCount).toBe(2);
    expect(Number(second.statement.totalBaseAmount)).toBe(150000);
  });

  it('re-calc on approved statement creates new with supersededBy on the old one', async () => {
    const o = await createOrder(100000);
    await pay(o.id, 100000, new Date('2026-04-10'));
    const first = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: userId,
    });
    // Manually mark approved
    await prisma.commissionStatement.update({
      where: { id: first.statement.id },
      data: { status: 'approved', approvedByUserId: userId, approvedAt: new Date() },
    });

    const second = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: userId,
    });
    expect(second.isNew).toBe(true);
    expect(second.statement.id).not.toBe(first.statement.id);

    const oldRefreshed = await prisma.commissionStatement.findUnique({
      where: { id: first.statement.id },
    });
    expect(oldRefreshed?.supersededBy).toBe(second.statement.id);
  });

  it('writes audit log on successful calculation', async () => {
    const o = await createOrder(100000);
    await pay(o.id, 100000, new Date('2026-04-10'));
    const before = await prisma.auditLog.count({
      where: { action: 'commission_statement_calculated' },
    });
    await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: userId,
    });
    const after = await prisma.auditLog.count({
      where: { action: 'commission_statement_calculated' },
    });
    expect(after).toBe(before + 1);
  });
});

// A2/§6.2: эффективная ставка платежа — приоритет
//   1) индивидуальная ставка организации → 2) история партнёра → 3) дефолт партнёра.
describe('calculateStatementForPartner — per-org commission override (A2)', () => {
  async function setOrgOverride(rate: number | null) {
    await prisma.organization.update({
      where: { id: orgId },
      data: { partnerCommissionRate: rate },
    });
  }
  async function addRateChange(effectiveFrom: Date, oldRate: number | null, newRate: number) {
    await prisma.commissionRateChange.create({
      data: { partnerId, effectiveFrom, oldRate, newRate, changedById: userId },
    });
  }

  it('priority 1: org override beats the partner default rate (0.25, not 0.1)', async () => {
    await setOrgOverride(0.25);
    const o = await createOrder(100000);
    await pay(o.id, 100000, new Date('2026-04-10'));
    const r = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    expect(Number(r.statement.totalCommissionAmount)).toBe(25000);
    expect(Number(r.statement.averageRate)).toBe(0.25);
    // The applied rate is frozen on the statement line (reproducibility — A5 note).
    const items = await prisma.commissionStatementItem.findMany({
      where: { statementId: r.statement.id },
    });
    expect(Number(items[0]!.rate)).toBe(0.25);
  });

  it('priority 1 wins even when partner rate history exists (override 0.3 vs history 0.2)', async () => {
    await setOrgOverride(0.3);
    await addRateChange(new Date('2026-04-05'), 0.1, 0.2);
    const o = await createOrder(100000);
    await pay(o.id, 100000, new Date('2026-04-10'));
    const r = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    expect(Number(r.statement.totalCommissionAmount)).toBe(30000);
  });

  it('priority 2: no override → historical partner rate at paidAt (0.2)', async () => {
    await addRateChange(new Date('2026-04-05'), 0.1, 0.2);
    const o = await createOrder(100000);
    await pay(o.id, 100000, new Date('2026-04-10')); // dated after the change → 0.2
    const r = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    expect(Number(r.statement.totalCommissionAmount)).toBe(20000);
  });

  it('priority 3: no override and no history → partner default rate (0.1)', async () => {
    const o = await createOrder(100000);
    await pay(o.id, 100000, new Date('2026-04-10'));
    const r = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    expect(Number(r.statement.totalCommissionAmount)).toBe(10000);
  });

  it('A3: VAT is never subtracted — base = full payment amount even with vatAmount set', async () => {
    await setOrgOverride(0.2);
    const o = await createOrder(120000);
    // A payment carrying an explicit VAT component must still be based on its FULL amount.
    await prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: o.id,
        amount: 120000,
        vatAmount: 20000,
        paidAt: new Date('2026-04-10'),
      },
    });
    const r = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: null,
    });
    expect(Number(r.statement.totalBaseAmount)).toBe(120000); // not 100000 (net-of-VAT)
    expect(Number(r.statement.totalCommissionAmount)).toBe(24000); // 120000 × 0.2
  });
});

// C-05: prevent double-counting from arbitrary, overlapping manual ranges.
describe('calculateStatementForPartner — overlap guard (C-05)', () => {
  const MAY_FROM = new Date('2026-05-01T00:00:00Z');
  const MAY_TO = new Date('2026-05-31T23:59:59Z');
  const STRADDLE_FROM = new Date('2026-04-15T00:00:00Z'); // overlaps April
  const STRADDLE_TO = new Date('2026-05-15T23:59:59Z');

  async function seedApril() {
    return calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: userId,
    });
  }

  it('returns period_overlap for a different range overlapping an existing statement', async () => {
    await seedApril();
    expect(
      await calculateStatementForPartner(prisma, {
        partnerId,
        periodFrom: STRADDLE_FROM,
        periodTo: STRADDLE_TO,
        calculatedByUserId: userId,
        rejectOverlap: true,
      })
    ).toEqual({ ok: false, error: 'period_overlap' });
  });

  it('allows the exact same period (in-place recalc, not an overlap)', async () => {
    await seedApril();
    const res = await calcOk({
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: userId,
      rejectOverlap: true,
    });
    expect(res.isNew).toBe(false);
  });

  it('allows an adjacent, non-overlapping month', async () => {
    await seedApril();
    const res = await calcOk({
      partnerId,
      periodFrom: MAY_FROM,
      periodTo: MAY_TO,
      calculatedByUserId: userId,
      rejectOverlap: true,
    });
    expect(res.isNew).toBe(true);
  });

  it('does not guard when rejectOverlap is omitted (cron path stays unblocked)', async () => {
    await seedApril();
    const res = await calcOk({
      partnerId,
      periodFrom: STRADDLE_FROM,
      periodTo: STRADDLE_TO,
      calculatedByUserId: userId,
    });
    expect(res.isNew).toBe(true);
  });
});

// C-01: at most one live statement per (partner, period), enforced by the
// partial-unique index — holds even under a race between two writers.
describe('calculateStatementForPartner — duplicate-accrual guard (C-01)', () => {
  it('partial-unique rejects a second live (non-superseded) statement for the same period', async () => {
    await prisma.commissionStatement.create({
      data: { partnerId, periodFrom: PERIOD_FROM, periodTo: PERIOD_TO },
    });
    await expect(
      prisma.commissionStatement.create({
        data: { partnerId, periodFrom: PERIOD_FROM, periodTo: PERIOD_TO },
      })
    ).rejects.toThrow();
  });

  it('allows a superseded row to coexist with a live one for the same period', async () => {
    const live = await prisma.commissionStatement.create({
      data: { partnerId, periodFrom: PERIOD_FROM, periodTo: PERIOD_TO },
    });
    const superseded = await prisma.commissionStatement.create({
      data: { partnerId, periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, supersededBy: live.id },
    });
    expect(superseded.id).toBeTruthy();
  });

  it('concurrent calc for the same NEW period yields exactly one live statement (no dup, no throw)', async () => {
    const o = await createOrder(100000);
    await pay(o.id, 100000, new Date('2026-04-10'));
    const results = await Promise.allSettled([
      calculateStatementForPartner(prisma, {
        partnerId,
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        calculatedByUserId: userId,
      }),
      calculateStatementForPartner(prisma, {
        partnerId,
        periodFrom: PERIOD_FROM,
        periodTo: PERIOD_TO,
        calculatedByUserId: userId,
      }),
    ]);
    // The race loser falls back to in-place update, so neither call rejects.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const live = await prisma.commissionStatement.findMany({
      where: { partnerId, periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, supersededBy: null },
    });
    expect(live).toHaveLength(1);
  });
});
