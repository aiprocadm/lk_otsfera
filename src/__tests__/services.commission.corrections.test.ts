import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';
import { approveStatement, markStatementPaid } from '@/lib/services/commission/lifecycle';
import { detectLateRefundCorrections, resolveCorrection } from '@/lib/services/commission/corrections';

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
  await prisma.payment.deleteMany({ where: { OR: [{ order: { partnerId } }, { organizationId: orgId }] } });
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
  await prisma.payment.deleteMany({ where: { OR: [{ order: { partnerId } }, { organizationId: orgId }] } });
  await prisma.order.deleteMany({ where: { partnerId } });
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
      data: { organizationId: orgId, orderId: o.id, amount: 100000, paidAt: new Date('2026-04-10') },
    });

    // Calculate April statement and move it to paid status
    const apr = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: aprFrom,
      periodTo: aprTo,
      calculatedByUserId: null,
    });
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
});
