import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';
import { approveStatement, markStatementPaid } from '@/lib/services/commission/lifecycle';
import {
  detectLateRefundCorrections,
  resolveCorrection,
} from '@/lib/services/commission/corrections';

let prisma: PrismaClient;
let partnerId: string;
let companyId: string;
let orgId: string;
let userId: string;
let adminUserId: string;

beforeAll(async () => {
  prisma = new PrismaClient();

  const p = await prisma.partner.create({
    data: { name: 'CorrectionP-' + Date.now(), commissionRate: 0.1 },
  });
  partnerId = p.id;

  const c = await prisma.company.create({ data: { name: 'CorrectionC-' + Date.now() } });
  companyId = c.id;

  const org = await prisma.organization.create({
    data: { name: 'CorrectionOrg-' + Date.now(), partnerId, companyId },
  });
  orgId = org.id;

  const u = await prisma.user.create({
    data: {
      email: 'correction-partner-' + Date.now() + '@x.local',
      passwordHash: 'h',
      name: 'U',
      role: 'partner',
      partnerId,
    },
  });
  userId = u.id;

  const admin = await prisma.user.create({
    data: {
      email: 'correction-admin-' + Date.now() + '@x.local',
      passwordHash: 'h',
      name: 'Admin',
      role: 'admin',
    },
  });
  adminUserId = admin.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [userId, adminUserId] } } });
  await prisma.commissionCorrection.deleteMany({ where: { partnerId } });
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.payment.deleteMany({
    where: { OR: [{ order: { partnerId } }, { organizationId: orgId }] },
  });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partnerUser.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, adminUserId] } } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Delete in FK-safe order: corrections reference payments and statements;
  // statement items reference statements and corrections.
  await prisma.commissionCorrection.deleteMany({ where: { partnerId } });
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.payment.deleteMany({
    where: { OR: [{ order: { partnerId } }, { organizationId: orgId }] },
  });
  await prisma.order.deleteMany({ where: { partnerId } });
  // A2 isolation: clear any per-org override left by a previous case.
  await prisma.organization.update({ where: { id: orgId }, data: { partnerCommissionRate: null } });
});

describe('A6/§9.5 — late refund correction end-to-end', () => {
  it('end-to-end: late refund into paid period → detect → apply → carried into next statement', async () => {
    const aprFrom = new Date('2026-04-01');
    const aprTo = new Date('2026-04-30T23:59:59Z');
    const mayFrom = new Date('2026-05-01');
    const mayTo = new Date('2026-05-31T23:59:59Z');

    const o = await prisma.order.create({
      data: {
        title: 'T',
        companyId,
        organizationId: orgId,
        partnerId,
        totalAmount: 100000,
        financialStatus: 'paid',
      },
    });
    await prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: o.id,
        amount: 100000,
        paidAt: new Date('2026-04-10'),
      },
    });

    // Calculate April statement and move it to paid status
    const apr = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: aprFrom,
      periodTo: aprTo,
      calculatedByUserId: null,
    });
    if (!apr.ok) throw new Error('expected ok');
    await approveStatement(prisma, {
      statementId: apr.statement.id,
      partnerId,
      approvedByUserId: userId,
    });
    await markStatementPaid(prisma, {
      statementId: apr.statement.id,
      paidByUserId: adminUserId,
    });

    // Late refund dated in April (after the statement is already paid)
    await prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: o.id,
        amount: 30000,
        paidAt: new Date('2026-04-20'),
        isRefund: true,
      },
    });

    // detectLateRefundCorrections should create exactly 1 needs_review correction
    const detected = await detectLateRefundCorrections(prisma);
    expect(detected).toBe(1);

    const corr = await prisma.commissionCorrection.findFirst({
      where: { partnerId, status: 'needs_review' },
    });
    expect(corr).toBeTruthy();
    // 30000 × 0.1 = 3000
    expect(Number(corr!.commissionAmount)).toBe(3000);

    // Admin applies the correction
    const res = await resolveCorrection(
      prisma,
      { role: 'admin', sub: adminUserId, companyId: null } as any,
      { correctionId: corr!.id, action: 'apply' }
    );
    expect(res).toEqual({ ok: true });

    // May statement: has a May payment, and should carry the -3000 correction line
    await prisma.payment.create({
      data: { organizationId: orgId, orderId: o.id, amount: 50000, paidAt: new Date('2026-05-10') },
    });
    const may = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: mayFrom,
      periodTo: mayTo,
      calculatedByUserId: null,
    });
    if (!may.ok) throw new Error('expected ok');

    const mayItems = await prisma.commissionStatementItem.findMany({
      where: { statementId: may.statement.id },
    });

    // The correction must appear as a statement item referencing corr.id
    expect(mayItems.some((i) => i.correctionId === corr!.id)).toBe(true);

    const corrLine = mayItems.find((i) => i.correctionId === corr!.id)!;
    // Correction line should be -3000 (negative, because it's a deduction)
    expect(Number(corrLine.commissionAmount)).toBe(-3000);

    // May payment: 50000 × 0.1 = 5000; minus correction 3000 = 2000
    expect(Number(may.statement.totalCommissionAmount)).toBe(2000);
  });

  it('A2: late refund reverses at the org override rate, not the partner default', async () => {
    // Договорная скидка 0.25 на организации; платёж и его поздний возврат должны
    // сторнироваться одной и той же эффективной ставкой (иначе перенос-минус не
    // сойдётся с исходным плюсом).
    await prisma.organization.update({
      where: { id: orgId },
      data: { partnerCommissionRate: 0.25 },
    });
    const aprFrom = new Date('2026-04-01');
    const aprTo = new Date('2026-04-30T23:59:59Z');

    const o = await prisma.order.create({
      data: {
        title: 'T',
        companyId,
        organizationId: orgId,
        partnerId,
        totalAmount: 100000,
        financialStatus: 'paid',
      },
    });
    await prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: o.id,
        amount: 100000,
        paidAt: new Date('2026-04-10'),
      },
    });
    const apr = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: aprFrom,
      periodTo: aprTo,
      calculatedByUserId: null,
    });
    if (!apr.ok) throw new Error('expected ok');
    // April commission at the override rate: 100000 × 0.25 = 25000.
    expect(Number(apr.statement.totalCommissionAmount)).toBe(25000);
    await approveStatement(prisma, {
      statementId: apr.statement.id,
      partnerId,
      approvedByUserId: userId,
    });
    await markStatementPaid(prisma, { statementId: apr.statement.id, paidByUserId: adminUserId });

    await prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: o.id,
        amount: 40000,
        paidAt: new Date('2026-04-20'),
        isRefund: true,
      },
    });
    expect(await detectLateRefundCorrections(prisma)).toBe(1);

    const corr = await prisma.commissionCorrection.findFirst({
      where: { partnerId, status: 'needs_review' },
    });
    // 40000 × 0.25 = 10000 (override), NOT × 0.1 = 4000 (partner default).
    expect(Number(corr!.rate)).toBe(0.25);
    expect(Number(corr!.commissionAmount)).toBe(10000);
  });

  it('A2/R2: a carried correction exceeding next-period payments → payout 0 + remainder carried again', async () => {
    const aprFrom = new Date('2026-04-01');
    const aprTo = new Date('2026-04-30T23:59:59Z');
    const mayFrom = new Date('2026-05-01');
    const mayTo = new Date('2026-05-31T23:59:59Z');
    const junFrom = new Date('2026-06-01');
    const junTo = new Date('2026-06-30T23:59:59Z');

    const o = await prisma.order.create({
      data: {
        title: 'T',
        companyId,
        organizationId: orgId,
        partnerId,
        totalAmount: 100000,
        financialStatus: 'paid',
      },
    });
    await prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: o.id,
        amount: 100000,
        paidAt: new Date('2026-04-10'),
      },
    });
    const apr = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: aprFrom,
      periodTo: aprTo,
      calculatedByUserId: null,
    });
    if (!apr.ok) throw new Error('expected ok');
    await approveStatement(prisma, {
      statementId: apr.statement.id,
      partnerId,
      approvedByUserId: userId,
    });
    await markStatementPaid(prisma, { statementId: apr.statement.id, paidByUserId: adminUserId });

    // Full refund in April, after the statement was paid → -10000 correction.
    await prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: o.id,
        amount: 100000,
        paidAt: new Date('2026-04-25'),
        isRefund: true,
      },
    });
    expect(await detectLateRefundCorrections(prisma)).toBe(1);
    const corr = await prisma.commissionCorrection.findFirst({
      where: { partnerId, status: 'needs_review' },
    });
    await resolveCorrection(prisma, { role: 'admin', sub: adminUserId, companyId: null } as any, {
      correctionId: corr!.id,
      action: 'apply',
    });

    // May: small payment 20000 → 2000; minus carried -10000 → net -8000 → clamp 0.
    await prisma.payment.create({
      data: { organizationId: orgId, orderId: o.id, amount: 20000, paidAt: new Date('2026-05-10') },
    });
    const may = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: mayFrom,
      periodTo: mayTo,
      calculatedByUserId: null,
    });
    if (!may.ok) throw new Error('expected ok');
    expect(Number(may.statement.totalCommissionAmount)).toBe(0); // payout clamped to ≥0

    // Approving May carries the uncovered remainder (8000) into the next period.
    await approveStatement(prisma, {
      statementId: may.statement.id,
      partnerId,
      approvedByUserId: userId,
    });
    const carried = await prisma.commissionCorrection.findFirst({
      where: { partnerId, status: 'applied', carriedReason: { not: null } },
    });
    expect(carried).toBeTruthy();
    expect(Number(carried!.commissionAmount)).toBe(8000);
    expect(carried!.parentCorrectionId).toBe(corr!.id);

    // June: payment 30000 → 3000; minus carried 8000 → net -5000 → clamp 0, carry line present.
    await prisma.payment.create({
      data: { organizationId: orgId, orderId: o.id, amount: 30000, paidAt: new Date('2026-06-10') },
    });
    const jun = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: junFrom,
      periodTo: junTo,
      calculatedByUserId: null,
    });
    if (!jun.ok) throw new Error('expected ok');
    const junItems = await prisma.commissionStatementItem.findMany({
      where: { statementId: jun.statement.id },
    });
    expect(junItems.some((i) => i.correctionId === carried!.id)).toBe(true);
    expect(Number(jun.statement.totalCommissionAmount)).toBe(0);
  });
});
