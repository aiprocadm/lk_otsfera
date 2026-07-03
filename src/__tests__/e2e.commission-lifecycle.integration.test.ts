import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';
import { approveStatement, markStatementPaid } from '@/lib/services/commission/lifecycle';
import { detectLateRefundCorrections } from '@/lib/services/commission/corrections';
import { renderStatementXlsx } from '@/lib/services/commission/xlsx';

/**
 * E2E commission lifecycle (integration-tier — real Postgres via `new PrismaClient()`):
 *
 *   payments-in-month (incl. refund) → statement calc with 3-way RATE PRIORITY
 *   → approve (draft→approved) → XLSX render (row-per-payment + total)
 *   → late refund after a PAID statement produces a negative carry-over correction.
 *
 * Uses the REAL commission services (statement / lifecycle / corrections / xlsx).
 * Money is Prisma.Decimal end-to-end; assertions compare via .toString()/.toFixed(2).
 * `STAMP` seeds unique fixture NAMES only — every assertion is on deterministic
 * ids/dates/amounts, never on Date.now().
 *
 * Rate resolution is proven with THREE organizations under ONE partner in ONE
 * period, isolating each mechanism by override + payment date vs the partner's
 * rate-change timeline (0.10 → 0.20 effective 2026-04-15):
 *   ORG-OVR  → Organization.partnerCommissionRate 0.07 wins over everything
 *              (priority 1), even paid 04-20 (after the 0.20 change).
 *   ORG-HIST → no override, paid 04-20 (AFTER the change) → historical rate 0.20
 *              at paidAt (priority 2).
 *   ORG-DEF  → no override, paid 04-10 (BEFORE the change) → historical rate at
 *              that date is the original 0.10. Same partner, rate differs by
 *              payment date — the essence of "rate at paidAt".
 */

let prisma: PrismaClient;
const STAMP = Date.now();

// Deterministic period + payment dates (asserted; never Date.now()).
const PERIOD_FROM = new Date('2026-04-01T00:00:00.000Z');
const PERIOD_TO = new Date('2026-04-30T23:59:59.999Z');
const PAID_AT = new Date('2026-04-20T00:00:00.000Z'); // after the 2026-04-15 rate change → 0.20
const PAID_AT_PRE = new Date('2026-04-10T00:00:00.000Z'); // before the change → original 0.10
const RATE_CHANGE_FROM = new Date('2026-04-15T00:00:00.000Z');

// Partner default rate 0.10; historical change to 0.20 effective 2026-04-15.
const PARTNER_DEFAULT_RATE = new Prisma.Decimal('0.1');
const PARTNER_HIST_RATE = new Prisma.Decimal('0.2');
const ORG_OVERRIDE_RATE = new Prisma.Decimal('0.07');

// Base payment amounts.
const AMOUNT_OVR = new Prisma.Decimal('100000');
const AMOUNT_HIST = new Prisma.Decimal('50000');
const AMOUNT_DEF = new Prisma.Decimal('20000');
const AMOUNT_REFUND = new Prisma.Decimal('10000'); // in-period refund on ORG-DEF (0.10)

let partnerId: string;
let partnerUserId: string;
let adminUserId: string;
let companyId: string;

let orgOvrId: string; // priority 1 — org override
let orgHistId: string; // priority 2 — partner history
let orgDefId: string; // priority 3 — partner default (+ in-period refund)

let payOvrId: string;
let payHistId: string;
let payDefId: string;
let payRefundId: string;

beforeAll(async () => {
  prisma = new PrismaClient();

  const partner = await prisma.partner.create({
    data: { name: `e2eComm-P-${STAMP}`, commissionRate: PARTNER_DEFAULT_RATE }
  });
  partnerId = partner.id;

  const company = await prisma.company.create({ data: { name: `e2eComm-C-${STAMP}` } });
  companyId = company.id;

  const partnerUser = await prisma.user.create({
    data: {
      email: `e2eComm-partner-${STAMP}@x.local`,
      passwordHash: 'h',
      name: 'Partner Admin',
      role: 'partner',
      partnerId
    }
  });
  partnerUserId = partnerUser.id;

  const admin = await prisma.user.create({
    data: {
      email: `e2eComm-admin-${STAMP}@x.local`,
      passwordHash: 'h',
      name: 'Platform Admin',
      role: 'admin'
    }
  });
  adminUserId = admin.id;

  // Partner historical rate change: 0.10 → 0.20 effective 2026-04-15.
  await prisma.commissionRateChange.create({
    data: {
      partnerId,
      oldRate: PARTNER_DEFAULT_RATE,
      newRate: PARTNER_HIST_RATE,
      effectiveFrom: RATE_CHANGE_FROM
    }
  });

  // ORG-OVR: individual org override 0.07 (priority 1).
  const orgOvr = await prisma.organization.create({
    data: {
      name: `e2eComm-OrgOVR-${STAMP}`,
      partnerId,
      companyId,
      partnerCommissionRate: ORG_OVERRIDE_RATE
    }
  });
  orgOvrId = orgOvr.id;

  // ORG-HIST: no override → historical partner rate 0.20 at paidAt (priority 2).
  const orgHist = await prisma.organization.create({
    data: { name: `e2eComm-OrgHIST-${STAMP}`, partnerId, companyId }
  });
  orgHistId = orgHist.id;

  // ORG-DEF: no override; its payments land BEFORE the 04-15 change, so the
  // historical rate at their paidAt is the original 0.10.
  const orgDef = await prisma.organization.create({
    data: { name: `e2eComm-OrgDEF-${STAMP}`, partnerId, companyId }
  });
  orgDefId = orgDef.id;

  // One paid order + payment per org (payment attribution via order.partnerId).
  const mkOrderPayment = async (
    organizationId: string,
    amount: Prisma.Decimal,
    isRefund = false,
    paidAt: Date = PAID_AT
  ) => {
    const order = await prisma.order.create({
      data: {
        title: `e2eComm-order-${organizationId}`,
        companyId,
        organizationId,
        partnerId,
        totalAmount: amount,
        financialStatus: 'paid'
      }
    });
    const payment = await prisma.payment.create({
      data: { organizationId, orderId: order.id, amount, paidAt, isRefund }
    });
    return payment.id;
  };

  payOvrId = await mkOrderPayment(orgOvrId, AMOUNT_OVR); // 04-20, override 0.07
  payHistId = await mkOrderPayment(orgHistId, AMOUNT_HIST); // 04-20, historical 0.20
  payDefId = await mkOrderPayment(orgDefId, AMOUNT_DEF, false, PAID_AT_PRE); // 04-10 → 0.10
  // In-period refund on ORG-DEF, also pre-change (rate 0.10) → negative line in the SAME statement.
  payRefundId = await mkOrderPayment(orgDefId, AMOUNT_REFUND, true, PAID_AT_PRE);
});

afterAll(async () => {
  const orgIds = [orgOvrId, orgHistId, orgDefId];
  await prisma.auditLog.deleteMany({ where: { userId: { in: [partnerUserId, adminUserId] } } });
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.commissionCorrection.deleteMany({ where: { partnerId } });
  await prisma.commissionRateChange.deleteMany({ where: { partnerId } });
  await prisma.organizationCommissionRateChange.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.payment.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [partnerUserId, adminUserId] } } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('E2E commission lifecycle: calc → rate priority → approve → XLSX → carry-over', () => {
  // Statement/correction ids captured across the ordered `it` blocks below.
  let statementId: string;

  it('(1)+(2) calculates a statement whose lines apply the 3-way rate priority', async () => {
    const res = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: partnerUserId
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(`unexpected calc failure: ${res.error}`);
    expect(res.isNew).toBe(true);
    statementId = res.statement.id;

    // 4 payment lines (3 positive + 1 refund); no corrections this period.
    expect(res.itemCount).toBe(4);

    const items = await prisma.commissionStatementItem.findMany({
      where: { statementId },
      orderBy: { paymentId: 'asc' }
    });
    const byPayment = new Map(items.map((i) => [i.paymentId, i]));

    // Rates read from a Decimal(6,4) column may carry trailing zeros as a string
    // (e.g. "0.2000"); compare numerically. Money is asserted exact via toFixed(2).

    // Priority 1 — org override 0.07 beats partner history (0.20) and default (0.10).
    const ovr = byPayment.get(payOvrId)!;
    expect(ovr.rate.toNumber()).toBe(0.07);
    expect(ovr.baseAmount.toFixed(2)).toBe('100000.00');
    expect(ovr.commissionAmount.toFixed(2)).toBe('7000.00'); // 100000 * 0.07

    // Priority 2 — no override → partner historical rate 0.20 at paidAt (post 04-15).
    const hist = byPayment.get(payHistId)!;
    expect(hist.rate.toNumber()).toBe(0.2);
    expect(hist.baseAmount.toFixed(2)).toBe('50000.00');
    expect(hist.commissionAmount.toFixed(2)).toBe('10000.00'); // 50000 * 0.20

    // Priority 3 value — no override, paid 04-10 BEFORE the change → historical
    // rate at that date is the original 0.10 (date-sensitivity of resolveRateAt).
    const def = byPayment.get(payDefId)!;
    expect(def.rate.toNumber()).toBe(0.1);
    expect(def.baseAmount.toFixed(2)).toBe('20000.00');
    expect(def.commissionAmount.toFixed(2)).toBe('2000.00'); // 20000 * 0.10

    // In-period refund (also 04-10) → negative base & commission at 0.10.
    const refund = byPayment.get(payRefundId)!;
    expect(refund.rate.toNumber()).toBe(0.1);
    expect(refund.baseAmount.toFixed(2)).toBe('-10000.00');
    expect(refund.commissionAmount.toFixed(2)).toBe('-1000.00'); // -10000 * 0.10

    // Statement totals: base = 100000+50000+20000-10000 = 160000;
    // commission = 7000+10000+2000-1000 = 18000.
    const stmt = await prisma.commissionStatement.findUniqueOrThrow({ where: { id: statementId } });
    expect(stmt.totalBaseAmount.toFixed(2)).toBe('160000.00');
    expect(stmt.totalCommissionAmount.toFixed(2)).toBe('18000.00');
    expect(stmt.status).toBe('draft');
  });

  it('(3) approves the statement (draft → approved)', async () => {
    const res = await approveStatement(prisma, {
      statementId,
      partnerId,
      approvedByUserId: partnerUserId
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected approve ok');
    expect(res.statement.status).toBe('approved');
    expect(res.statement.approvedByUserId).toBe(partnerUserId);
    expect(res.statement.approvedAt).not.toBeNull();
  });

  it('(4) renders XLSX with a row per payment and the correct total', async () => {
    // Mirror the real XLSX worker: load the persisted statement + items + partner.
    const statement = await prisma.commissionStatement.findUniqueOrThrow({
      where: { id: statementId },
      include: { items: true, partner: true }
    });

    // renderStatementXlsx returns an ExcelJS buffer (typed `any`); pass it straight
    // to load() as services.commission.xlsx.test.ts does — wrapping in Buffer.from
    // trips the @types/node Buffer<ArrayBufferLike> vs ExcelJS Buffer type mismatch.
    const buf = await renderStatementXlsx({
      statement,
      items: statement.items,
      partner: { name: statement.partner.name }
    });
    expect(buf.length).toBeGreaterThan(1000);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    // Items sheet: header row + one row per payment line (4).
    const itemsSheet = wb.getWorksheet('Items');
    expect(itemsSheet).toBeDefined();
    expect(itemsSheet!.rowCount).toBe(1 + statement.items.length);
    expect(itemsSheet!.rowCount).toBe(5);

    // Column 6 = Комиссия, ₽ (see xlsx.ts column order). Sum data rows (skip header).
    let commissionSum = 0;
    for (let r = 2; r <= itemsSheet!.rowCount; r++) {
      commissionSum += Number(itemsSheet!.getRow(r).getCell(6).value);
    }
    expect(commissionSum).toBeCloseTo(18000, 2);

    // Summary sheet carries partner name + the total commission (16000-style label).
    const summary = wb.getWorksheet('Summary');
    expect(summary).toBeDefined();
    const flat = (summary!.getSheetValues() as unknown[][])
      .flat()
      .filter(Boolean)
      .map(String);
    expect(flat).toContain(statement.partner.name);
    // "Итого комиссия, ₽" value cell holds the numeric total. On a LOADED workbook
    // exceljs drops column keys, so address the value column by index (2), not key.
    const totalRow = summary!.getRow(7); // 7th summary row = Итого комиссия
    expect(Number(totalRow.getCell(2).value)).toBeCloseTo(18000, 2);
  });

  it('(5) a late refund after the paid statement carries a negative correction to the next period', async () => {
    // Move the statement to PAID (platform admin) so the period is "closed".
    const paid = await markStatementPaid(prisma, {
      statementId,
      paidByUserId: adminUserId
    });
    expect(paid.ok).toBe(true);
    if (!paid.ok) throw new Error('expected markPaid ok');
    expect(paid.statement.status).toBe('paid');

    // A late refund whose paidAt falls INSIDE the already-paid April period, on
    // ORG-DEF and BEFORE the 04-15 change (effective rate 0.10).
    // detectLateRefundCorrections must mint a needs_review correction (idempotent
    // by paymentId) sized amount * effective-rate. NOTE: the April in-period refund
    // also becomes eligible now that April is paid, so createdCount is >= 1; we then
    // pin the assertion to THIS late refund's correction by paymentId.
    const lateRefundOrder = await prisma.order.create({
      data: {
        title: `e2eComm-late-refund-${STAMP}`,
        companyId,
        organizationId: orgDefId,
        partnerId,
        totalAmount: new Prisma.Decimal('15000'),
        financialStatus: 'paid'
      }
    });
    const lateRefund = await prisma.payment.create({
      data: {
        organizationId: orgDefId,
        orderId: lateRefundOrder.id,
        amount: new Prisma.Decimal('15000'),
        paidAt: PAID_AT_PRE, // inside the paid April period, before 04-15 change → 0.10
        isRefund: true
      }
    });

    const createdCount = await detectLateRefundCorrections(prisma);
    expect(createdCount).toBeGreaterThanOrEqual(1);

    const correction = await prisma.commissionCorrection.findUnique({
      where: { paymentId: lateRefund.id }
    });
    expect(correction).not.toBeNull();
    expect(correction!.partnerId).toBe(partnerId);
    expect(correction!.status).toBe('needs_review');
    // Effective rate on the default-rate org = 0.10 (no override, no post-04-15 issue
    // for the org). amount stored positive; commissionAmount = 15000 * 0.10 = 1500.
    expect(correction!.rate.toNumber()).toBe(0.1);
    expect(correction!.amount.toFixed(2)).toBe('15000.00');
    expect(correction!.commissionAmount.toFixed(2)).toBe('1500.00');
    // Carries a link back to the closed (original) period.
    expect(correction!.originalStatementId).toBe(statementId);
    expect(correction!.originalPeriodFrom.toISOString()).toBe(PERIOD_FROM.toISOString());
    expect(correction!.originalPeriodTo.toISOString()).toBe(PERIOD_TO.toISOString());

    // Carry-over into the NEXT period: applying the correction, then recalculating a
    // future draft period pulls it in as a NEGATIVE line (statement.ts pendingCorrections).
    await prisma.commissionCorrection.update({
      where: { id: correction!.id },
      data: { status: 'applied', resolvedByUserId: adminUserId, resolvedAt: new Date() }
    });

    const NEXT_FROM = new Date('2026-05-01T00:00:00.000Z');
    const NEXT_TO = new Date('2026-05-31T23:59:59.999Z');
    const next = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: NEXT_FROM,
      periodTo: NEXT_TO,
      calculatedByUserId: partnerUserId
    });
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error(`unexpected next-period calc failure: ${next.error}`);

    const nextItems = await prisma.commissionStatementItem.findMany({
      where: { statementId: next.statement.id }
    });
    // No May payments exist → the only line is the carried correction (negative).
    const corrLine = nextItems.find((i) => i.correctionId === correction!.id);
    expect(corrLine).toBeDefined();
    expect(corrLine!.commissionAmount.toFixed(2)).toBe('-1500.00'); // negated by statement.ts
    expect(corrLine!.baseAmount.toFixed(2)).toBe('-15000.00');

    // R2 clamp: a negative-only period does not go negative in the payable total.
    expect(next.statement.totalCommissionAmount.toFixed(2)).toBe('0.00');
  });
});

// This file is integration-tier (vitest classifies by the `new PrismaClient(` call in
// beforeAll). No external system is touched: renderStatementXlsx is pure, and
// statement.ts only enqueues BullMQ jobs when REDIS_URL is set (absent in tests), so
// no S3/BullMQ/email/1C path is exercised — nothing to vi.mock.
