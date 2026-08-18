import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  getFunnelAnalytics,
  getPlanFact,
  upsertSalesTarget,
  monthRange,
} from '@/lib/services/leader/analytics';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * M3 close-out regression (спека 2026-07-16, Task 4) — final integration
 * coverage for `getFunnelAnalytics`/`getPlanFact`/`upsertSalesTarget` against
 * the live DB. Mirrors `services.deal-activity.idor.integration.test.ts`:
 * seed real rows with a bare `new PrismaClient()`, assert cross-company (C8)
 * isolation + net-fact math, clean up in afterAll.
 *
 * Covers:
 *   1. upsertSalesTarget cross-company — leader of company A cannot set a
 *      target for a manager belonging to company B.
 *   2. upsertSalesTarget idempotency — repeated upsert updates the same row
 *      (unique companyId_managerId_year_month), targetAmount:null clears it.
 *   3. getPlanFact isolation + netting — leader A's plan/fact never surfaces
 *      company B's payments; refund netting + out-of-period exclusion hold.
 *   4. getFunnelAnalytics cohort scope (§0.8) — Lead has no companyId, so the
 *      isolation boundary is assignedManager.companyId (+ unassigned = shared
 *      queue); company B's assigned lead must never appear.
 *   5. getFunnelAnalytics snapshot scope — same OR-scope boundary applies to
 *      the current-state stage snapshot.
 */

const prisma = new PrismaClient();
const STAMP = `leaderAn${Date.now()}`;
const TEST_YEAR = 2026;
const TEST_MONTH = 3; // fixed past month — Payment/Lead createdAt/paidAt pinned inside/outside it

let companyA: string, companyB: string;
let leaderA: string, mgrA: string, mgrB: string;
let partnerId: string, partnerUser: string;
let orgA: string, orgB: string;
let orderA: string, orderB: string;
let paymentIds: string[] = [];
let leadIds: string[] = [];

function leaderSession(sub: string, companyId: string): SessionPayload {
  return { sub, role: 'leader', companyId } as unknown as SessionPayload;
}

beforeAll(async () => {
  const cA = await prisma.company.create({ data: { name: `${STAMP}-coA` } });
  companyA = cA.id;
  const cB = await prisma.company.create({ data: { name: `${STAMP}-coB` } });
  companyB = cB.id;

  const uLeaderA = await prisma.user.create({
    data: {
      email: `${STAMP}-leaderA@x.local`,
      name: `Leader A ${STAMP}`,
      role: 'leader',
      companyId: companyA,
      passwordHash: 'x',
    },
  });
  leaderA = uLeaderA.id;

  const uMgrA = await prisma.user.create({
    data: {
      email: `${STAMP}-mgrA@x.local`,
      name: `Manager A ${STAMP}`,
      role: 'manager',
      companyId: companyA,
      passwordHash: 'x',
    },
  });
  mgrA = uMgrA.id;

  const uMgrB = await prisma.user.create({
    data: {
      email: `${STAMP}-mgrB@x.local`,
      name: `Manager B ${STAMP}`,
      role: 'manager',
      companyId: companyB,
      passwordHash: 'x',
    },
  });
  mgrB = uMgrB.id;

  const partner = await prisma.partner.create({ data: { name: `${STAMP}-partner` } });
  partnerId = partner.id;
  const uPartner = await prisma.user.create({
    data: {
      email: `${STAMP}-partner@x.local`,
      name: `Partner ${STAMP}`,
      role: 'partner',
      partnerId,
      passwordHash: 'x',
    },
  });
  partnerUser = uPartner.id;

  const oA = await prisma.organization.create({
    data: { name: `${STAMP}-orgA`, companyId: companyA },
  });
  orgA = oA.id;
  const oB = await prisma.organization.create({
    data: { name: `${STAMP}-orgB`, companyId: companyB },
  });
  orgB = oB.id;

  const ordA = await prisma.order.create({
    data: {
      title: `${STAMP}-order-A`,
      companyId: companyA,
      organizationId: orgA,
      managerId: mgrA,
      totalAmount: 0,
    },
  });
  orderA = ordA.id;
  const ordB = await prisma.order.create({
    data: {
      title: `${STAMP}-order-B`,
      companyId: companyB,
      organizationId: orgB,
      managerId: mgrB,
      totalAmount: 0,
    },
  });
  orderB = ordB.id;

  // --- Payments: orderA netting inside/outside TEST_YEAR/TEST_MONTH; orderB isolation ---
  const inMonth = new Date(TEST_YEAR, TEST_MONTH - 1, 10);
  const inMonthRefund = new Date(TEST_YEAR, TEST_MONTH - 1, 15);
  const outOfMonth = new Date(TEST_YEAR, TEST_MONTH, 5); // next month — must be excluded

  const pA1 = await prisma.payment.create({
    data: {
      organizationId: orgA,
      orderId: orderA,
      amount: '1000.00',
      paidAt: inMonth,
      isRefund: false,
    },
  });
  const pA2 = await prisma.payment.create({
    data: {
      organizationId: orgA,
      orderId: orderA,
      amount: '200.00',
      paidAt: inMonthRefund,
      isRefund: true,
    },
  });
  const pA3 = await prisma.payment.create({
    data: {
      organizationId: orgA,
      orderId: orderA,
      amount: '500.00',
      paidAt: outOfMonth,
      isRefund: false,
    },
  });
  const pB1 = await prisma.payment.create({
    data: {
      organizationId: orgB,
      orderId: orderB,
      amount: '9999.00',
      paidAt: inMonth,
      isRefund: false,
    },
  });
  paymentIds = [pA1.id, pA2.id, pA3.id, pB1.id];

  // --- Leads: cohort/snapshot scope fixture, all created inside TEST_YEAR/TEST_MONTH ---
  const leadCreatedAt = new Date(TEST_YEAR, TEST_MONTH - 1, 12);
  const baseLead = {
    partnerId,
    createdByUserId: partnerUser,
    clientCompanyName: `${STAMP}-client`,
    clientContactName: `${STAMP}-contact`,
    subject: `${STAMP}-subject`,
    status: 'new' as const,
    createdAt: leadCreatedAt,
  };
  const leadUnassigned = await prisma.lead.create({
    data: { ...baseLead, assignedManagerId: null },
  });
  const leadA = await prisma.lead.create({ data: { ...baseLead, assignedManagerId: mgrA } });
  const leadB = await prisma.lead.create({ data: { ...baseLead, assignedManagerId: mgrB } });
  leadIds = [leadUnassigned.id, leadA.id, leadB.id];
});

afterAll(async () => {
  await prisma.salesTarget.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
  await prisma.auditLog.deleteMany({ where: { userId: leaderA } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.order.deleteMany({ where: { id: { in: [orderA, orderB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [partnerUser] } } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.user.deleteMany({ where: { id: { in: [leaderA, mgrA, mgrB] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('M3 leader analytics — upsertSalesTarget cross-company (C8)', () => {
  it('leader of company A cannot set a target for a manager of company B', async () => {
    const res = await upsertSalesTarget(prisma, leaderSession(leaderA, companyA), {
      managerId: mgrB,
      year: TEST_YEAR,
      month: TEST_MONTH,
      targetAmount: '100000.00',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });

    const count = await prisma.salesTarget.count({
      where: { companyId: companyA, managerId: mgrB, year: TEST_YEAR, month: TEST_MONTH },
    });
    expect(count).toBe(0);
    const countB = await prisma.salesTarget.count({
      where: { companyId: companyB, managerId: mgrB, year: TEST_YEAR, month: TEST_MONTH },
    });
    expect(countB).toBe(0);
  });

  it('is idempotent (single row survives repeated upsert) and clears on targetAmount:null', async () => {
    const first = await upsertSalesTarget(prisma, leaderSession(leaderA, companyA), {
      managerId: mgrA,
      year: TEST_YEAR,
      month: TEST_MONTH,
      targetAmount: '100000.00',
    });
    expect(first).toEqual({ ok: true });

    const second = await upsertSalesTarget(prisma, leaderSession(leaderA, companyA), {
      managerId: mgrA,
      year: TEST_YEAR,
      month: TEST_MONTH,
      targetAmount: '150000.00',
    });
    expect(second).toEqual({ ok: true });

    const rows = await prisma.salesTarget.findMany({
      where: { companyId: companyA, managerId: mgrA, year: TEST_YEAR, month: TEST_MONTH },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].targetAmount.toFixed(2)).toBe('150000.00');

    const cleared = await upsertSalesTarget(prisma, leaderSession(leaderA, companyA), {
      managerId: mgrA,
      year: TEST_YEAR,
      month: TEST_MONTH,
      targetAmount: null,
    });
    expect(cleared).toEqual({ ok: true });

    const rowsAfterClear = await prisma.salesTarget.findMany({
      where: { companyId: companyA, managerId: mgrA, year: TEST_YEAR, month: TEST_MONTH },
    });
    expect(rowsAfterClear).toHaveLength(0);
  });
});

describe('M3 leader analytics — getPlanFact isolation + netting', () => {
  it("leader A's plan/fact nets refunds, excludes out-of-period payments, and never surfaces company B", async () => {
    const res = await getPlanFact(prisma, leaderSession(leaderA, companyA), {
      year: TEST_YEAR,
      month: TEST_MONTH,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const rowA = res.rows.find((r) => r.managerId === mgrA);
    expect(rowA).toBeDefined();
    // 1000.00 - 200.00 refund = 800.00; the 500.00 paid next month is excluded.
    expect(rowA?.fact).toBe('800.00');

    expect(res.rows.some((r) => r.managerId === mgrB)).toBe(false);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('9999.00');

    expect(res.totals.fact).toBe('800.00');
  });
});

describe('M3 leader analytics — getFunnelAnalytics cohort scope (§0.8)', () => {
  it("leader A's cohort excludes company B's assigned lead; unassigned (shared queue) + mgrA's lead count", async () => {
    const res = await getFunnelAnalytics(
      prisma,
      leaderSession(leaderA, companyA),
      monthRange(TEST_YEAR, TEST_MONTH)
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.cohort.total).toBe(2);

    const rowA = res.perManager.find((r) => r.managerId === mgrA);
    expect(rowA).toBeDefined();
    expect(rowA?.assigned).toBe(1);

    const unassignedRow = res.perManager.find((r) => r.managerId === null);
    expect(unassignedRow).toBeDefined();
    expect(unassignedRow?.assigned).toBe(1);

    expect(res.perManager.some((r) => r.managerId === mgrB)).toBe(false);
  });
});

describe('M3 leader analytics — getFunnelAnalytics snapshot scope', () => {
  it("leader A's open-stage snapshot excludes company B's lead", async () => {
    const res = await getFunnelAnalytics(
      prisma,
      leaderSession(leaderA, companyA),
      monthRange(TEST_YEAR, TEST_MONTH)
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const totalSnapshotCount = res.snapshot.reduce((sum, s) => sum + s.count, 0);
    expect(totalSnapshotCount).toBe(2);
  });
});

describe('этап 6 ФТ-4.5 — выигранные сделки в план/факте', () => {
  it('won-сделки месяца попадают в строку менеджера и totals; чужая компания и другой период — нет', async () => {
    const inMonth = new Date(Date.UTC(TEST_YEAR, TEST_MONTH - 1, 10));
    const outMonth = new Date(Date.UTC(TEST_YEAR, TEST_MONTH, 5)); // следующий месяц
    const created = await Promise.all([
      prisma.deal.create({
        data: {
          companyId: companyA,
          title: `${STAMP}-dealA1`,
          managerId: mgrA,
          status: 'won',
          wonAt: inMonth,
          amount: '30000.00',
        },
      }),
      prisma.deal.create({
        data: {
          companyId: companyA,
          title: `${STAMP}-dealA2`,
          managerId: mgrA,
          status: 'won',
          wonAt: inMonth,
          amount: null,
        }, // won без суммы
      }),
      prisma.deal.create({
        data: {
          companyId: companyA,
          title: `${STAMP}-dealA3`,
          managerId: mgrA,
          status: 'won',
          wonAt: outMonth,
          amount: '999.00',
        }, // вне периода
      }),
      prisma.deal.create({
        data: {
          companyId: companyA,
          title: `${STAMP}-dealA4`,
          managerId: mgrA,
          status: 'open',
          amount: '111.00',
        }, // не won
      }),
      prisma.deal.create({
        data: {
          companyId: companyB,
          title: `${STAMP}-dealB1`,
          managerId: mgrB,
          status: 'won',
          wonAt: inMonth,
          amount: '50000.00',
        }, // чужая компания
      }),
    ]);
    try {
      const res = await getPlanFact(prisma, leaderSession(leaderA, companyA), {
        year: TEST_YEAR,
        month: TEST_MONTH,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const rowA = res.rows.find((r) => r.managerId === mgrA);
      expect(rowA).toBeDefined();
      expect(rowA!.wonDeals).toBe(2); // A1 + A2 (без суммы), A3 вне периода, A4 не won
      expect(rowA!.wonAmount).toBe('30000.00');
      expect(res.totals.wonAmount).toBe('30000.00'); // B-шная сделка не просочилась
      expect(res.rows.some((r) => r.managerId === mgrB)).toBe(false);
    } finally {
      await prisma.deal.deleteMany({ where: { id: { in: created.map((d) => d.id) } } });
    }
  });
});
