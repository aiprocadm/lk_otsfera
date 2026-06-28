import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setOrgCommissionRate, clearOrgCommissionRate } from '@/lib/services/partner/rateOverride';

let prisma: PrismaClient;
let partnerId: string;
let userId: string;
let orgId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({ data: { name: 'RP-' + Date.now(), commissionRate: 0.05 } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'RC-' + Date.now() } });
  const org = await prisma.organization.create({ data: { name: 'OR', partnerId, companyId: c.id } });
  orgId = org.id;
  const u = await prisma.user.create({
    data: { email: `ro-${Date.now()}@x.local`, passwordHash: 'h', name: 'A', role: 'partner', partnerId }
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'RC-' } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      partnerCommissionRate: null,
      partnerCommissionRateNote: null,
      partnerCommissionRateChangedAt: null,
      partnerCommissionRateChangedBy: null
    }
  });
});

describe('setOrgCommissionRate', () => {
  it('updates partnerCommissionRate and metadata fields', async () => {
    await setOrgCommissionRate(prisma, {
      organizationId: orgId, partnerId,
      newRate: 0.08, reason: 'VIP клиент', changedByUserId: userId
    });

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.partnerCommissionRate?.toString()).toBe('0.08');
    expect(org.partnerCommissionRateNote).toBe('VIP клиент');
    expect(org.partnerCommissionRateChangedBy).toBe(userId);
    expect(org.partnerCommissionRateChangedAt).toBeInstanceOf(Date);
  });

  it('writes AuditLog with before/after rate', async () => {
    await setOrgCommissionRate(prisma, {
      organizationId: orgId, partnerId,
      newRate: 0.08, reason: 'VIP', changedByUserId: userId
    });

    const audit = await prisma.auditLog.findFirst({
      where: { userId, entity: 'organization', entityId: orgId },
      orderBy: { createdAt: 'desc' }
    });
    expect(audit).not.toBeNull();
    expect(audit!.action).toBe('partner_commission_rate_changed');
    const meta = audit!.meta as {
      before?: { rate: string };
      after?: { rate: string };
      reason?: string;
    };
    expect(meta.before?.rate).toBe('inherited');
    expect(meta.after?.rate).toBe('0.08');
    expect(meta.reason).toBe('VIP');
  });

  it('rejects rates out of (0, 1) range', async () => {
    expect(
      await setOrgCommissionRate(prisma, {
        organizationId: orgId, partnerId,
        newRate: -0.1, reason: 'X', changedByUserId: userId
      })
    ).toEqual({ ok: false, error: 'rate_out_of_range' });

    expect(
      await setOrgCommissionRate(prisma, {
        organizationId: orgId, partnerId,
        newRate: 1.5, reason: 'X', changedByUserId: userId
      })
    ).toEqual({ ok: false, error: 'rate_out_of_range' });
  });

  it('refuses to change org outside partner', async () => {
    expect(
      await setOrgCommissionRate(prisma, {
        organizationId: orgId, partnerId: 'no-such',
        newRate: 0.08, reason: 'X', changedByUserId: userId
      })
    ).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('clearOrgCommissionRate', () => {
  it('nullifies rate and writes audit log', async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        partnerCommissionRate: 0.08,
        partnerCommissionRateNote: 'old',
        partnerCommissionRateChangedAt: new Date(),
        partnerCommissionRateChangedBy: userId
      }
    });

    await clearOrgCommissionRate(prisma, {
      organizationId: orgId, partnerId, reason: 'вернуть базу', changedByUserId: userId
    });

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.partnerCommissionRate).toBeNull();
    expect(org.partnerCommissionRateNote).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { userId, action: 'partner_commission_rate_changed' },
      orderBy: { createdAt: 'desc' }
    });
    expect(audit).not.toBeNull();
    const meta = audit!.meta as {
      before?: { rate: string };
      after?: { rate: string };
    };
    expect(meta.before?.rate).toBe('0.08');
    expect(meta.after?.rate).toBe('cleared');
  });
});
