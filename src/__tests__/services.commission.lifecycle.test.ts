import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { approveStatement, markStatementPaid } from '@/lib/services/commission/lifecycle';

let prisma: PrismaClient;
let partnerId: string;
let partnerUserId: string;
let platformAdminUserId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({
    data: { name: 'LCP-' + Date.now(), commissionRate: 0.1 }
  });
  partnerId = p.id;
  const pu = await prisma.user.create({
    data: {
      email: 'lc-partner-' + Date.now() + '@x.local',
      passwordHash: 'h',
      name: 'PU',
      role: 'partner',
      partnerId
    }
  });
  partnerUserId = pu.id;
  const a = await prisma.user.create({
    data: {
      email: 'lc-admin-' + Date.now() + '@x.local',
      passwordHash: 'h',
      name: 'A',
      role: 'admin'
    }
  });
  platformAdminUserId = a.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [partnerUserId, platformAdminUserId] } }
  });
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { id: { in: [partnerUserId, platformAdminUserId] } } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
});

async function createDraft() {
  return prisma.commissionStatement.create({
    data: {
      partnerId,
      periodFrom: new Date('2026-04-01'),
      periodTo: new Date('2026-04-30'),
      totalBaseAmount: 100000,
      averageRate: 0.1,
      totalCommissionAmount: 10000,
      status: 'draft'
    }
  });
}

describe('approveStatement', () => {
  it('transitions draft → approved with timestamp + audit', async () => {
    const draft = await createDraft();
    const before = await prisma.auditLog.count({
      where: { action: 'commission_statement_approved' }
    });
    const updated = await approveStatement(prisma, {
      statementId: draft.id,
      partnerId,
      approvedByUserId: partnerUserId
    });
    expect(updated.status).toBe('approved');
    expect(updated.approvedAt).not.toBeNull();
    expect(updated.approvedByUserId).toBe(partnerUserId);
    const after = await prisma.auditLog.count({
      where: { action: 'commission_statement_approved' }
    });
    expect(after).toBe(before + 1);
  });

  it('rejects when statement belongs to another partner', async () => {
    const otherP = await prisma.partner.create({ data: { name: 'OtherP-' + Date.now() } });
    const draft = await prisma.commissionStatement.create({
      data: {
        partnerId: otherP.id,
        periodFrom: new Date('2026-04-01'),
        periodTo: new Date('2026-04-30'),
        totalBaseAmount: 0,
        averageRate: 0,
        totalCommissionAmount: 0,
        status: 'draft'
      }
    });
    await expect(
      approveStatement(prisma, {
        statementId: draft.id,
        partnerId,
        approvedByUserId: partnerUserId
      })
    ).rejects.toThrow(/NOT_FOUND/);
    await prisma.commissionStatement.deleteMany({ where: { partnerId: otherP.id } });
    await prisma.partner.deleteMany({ where: { id: otherP.id } });
  });

  it('rejects double approve (LIFECYCLE_VIOLATION)', async () => {
    const draft = await createDraft();
    await approveStatement(prisma, {
      statementId: draft.id,
      partnerId,
      approvedByUserId: partnerUserId
    });
    await expect(
      approveStatement(prisma, {
        statementId: draft.id,
        partnerId,
        approvedByUserId: partnerUserId
      })
    ).rejects.toThrow(/LIFECYCLE_VIOLATION/);
  });

  it('rejects approve on superseded statement', async () => {
    const draft = await createDraft();
    await prisma.commissionStatement.update({
      where: { id: draft.id },
      data: { supersededBy: 'fake-id' }
    });
    await expect(
      approveStatement(prisma, {
        statementId: draft.id,
        partnerId,
        approvedByUserId: partnerUserId
      })
    ).rejects.toThrow(/LIFECYCLE_VIOLATION/);
  });
});

describe('markStatementPaid', () => {
  it('transitions approved → paid by platform admin', async () => {
    const draft = await createDraft();
    await approveStatement(prisma, {
      statementId: draft.id,
      partnerId,
      approvedByUserId: partnerUserId
    });
    const updated = await markStatementPaid(prisma, {
      statementId: draft.id,
      paidByUserId: platformAdminUserId
    });
    expect(updated.status).toBe('paid');
    expect(updated.paidAt).not.toBeNull();
  });

  it('rejects markPaid on draft (must approve first)', async () => {
    const draft = await createDraft();
    await expect(
      markStatementPaid(prisma, {
        statementId: draft.id,
        paidByUserId: platformAdminUserId
      })
    ).rejects.toThrow(/LIFECYCLE_VIOLATION/);
  });

  it('rejects markPaid by non-admin user', async () => {
    const draft = await createDraft();
    await approveStatement(prisma, {
      statementId: draft.id,
      partnerId,
      approvedByUserId: partnerUserId
    });
    await expect(
      markStatementPaid(prisma, {
        statementId: draft.id,
        paidByUserId: partnerUserId
      })
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('rejects double markPaid (LIFECYCLE_VIOLATION)', async () => {
    const draft = await createDraft();
    await approveStatement(prisma, {
      statementId: draft.id,
      partnerId,
      approvedByUserId: partnerUserId
    });
    await markStatementPaid(prisma, {
      statementId: draft.id,
      paidByUserId: platformAdminUserId
    });
    await expect(
      markStatementPaid(prisma, {
        statementId: draft.id,
        paidByUserId: platformAdminUserId
      })
    ).rejects.toThrow(/LIFECYCLE_VIOLATION/);
  });

  it('writes audit log on successful payment', async () => {
    const draft = await createDraft();
    await approveStatement(prisma, {
      statementId: draft.id,
      partnerId,
      approvedByUserId: partnerUserId
    });
    const before = await prisma.auditLog.count({
      where: { action: 'commission_statement_paid' }
    });
    await markStatementPaid(prisma, {
      statementId: draft.id,
      paidByUserId: platformAdminUserId
    });
    const after = await prisma.auditLog.count({
      where: { action: 'commission_statement_paid' }
    });
    expect(after).toBe(before + 1);
  });
});
