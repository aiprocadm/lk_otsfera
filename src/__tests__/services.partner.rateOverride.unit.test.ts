/**
 * Unit tests for src/lib/services/partner/rateOverride.ts
 * Covers branches missed by the integration test (audit before.rate field).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setOrgCommissionRate, clearOrgCommissionRate } from '@/lib/services/partner/rateOverride';

const recordAuditMock = vi.fn();
vi.mock('@/lib/auth/audit', () => ({ recordAudit: (...args: any[]) => recordAuditMock(...args) }));

function makeTx() {
  return {
    organization: { update: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn() }
  } as any;
}

function makePrisma(org: object | null) {
  const tx = makeTx();
  return {
    organization: { findFirst: vi.fn().mockResolvedValue(org) },
    $transaction: vi.fn().mockImplementation((cb: (arg: unknown) => unknown) => cb(tx)),
    _tx: tx
  } as any;
}

describe('setOrgCommissionRate — unit', () => {
  beforeEach(() => { recordAuditMock.mockReset().mockResolvedValue(undefined); });

  it('throws RATE_OUT_OF_RANGE for negative rate', async () => {
    await expect(setOrgCommissionRate(makePrisma(null), {
      organizationId: 'o1', partnerId: 'p1', newRate: -0.1, reason: 'x', changedByUserId: 'u1'
    })).rejects.toThrow('RATE_OUT_OF_RANGE');
  });

  it('throws RATE_OUT_OF_RANGE for rate >= 1', async () => {
    await expect(setOrgCommissionRate(makePrisma(null), {
      organizationId: 'o1', partnerId: 'p1', newRate: 1, reason: 'x', changedByUserId: 'u1'
    })).rejects.toThrow('RATE_OUT_OF_RANGE');
  });

  it('throws NOT_FOUND when org not under partner', async () => {
    await expect(setOrgCommissionRate(makePrisma(null), {
      organizationId: 'o1', partnerId: 'p1', newRate: 0.1, reason: 'x', changedByUserId: 'u1'
    })).rejects.toThrow('NOT_FOUND');
  });

  it('records "inherited" in audit before.rate when existing rate is null', async () => {
    const prisma = makePrisma({ id: 'o1', partnerCommissionRate: null });
    await setOrgCommissionRate(prisma, {
      organizationId: 'o1', partnerId: 'p1', newRate: 0.08, reason: 'VIP', changedByUserId: 'u1'
    });
    const [, auditArgs] = recordAuditMock.mock.calls[0];
    expect(auditArgs.before.rate).toBe('inherited');
    expect(auditArgs.after.rate).toBe('0.08');
  });

  it('records existing rate in audit before.rate when rate is set', async () => {
    const existingRate = { toString: () => '0.05' };
    const prisma = makePrisma({ id: 'o1', partnerCommissionRate: existingRate });
    await setOrgCommissionRate(prisma, {
      organizationId: 'o1', partnerId: 'p1', newRate: 0.08, reason: 'Upgrade', changedByUserId: 'u1'
    });
    const [, auditArgs] = recordAuditMock.mock.calls[0];
    expect(auditArgs.before.rate).toBe('0.05');
    expect(auditArgs.after.rate).toBe('0.08');
  });
});

describe('clearOrgCommissionRate — unit', () => {
  beforeEach(() => { recordAuditMock.mockReset().mockResolvedValue(undefined); });

  it('throws NOT_FOUND when org not under partner', async () => {
    await expect(clearOrgCommissionRate(makePrisma(null), {
      organizationId: 'o1', partnerId: 'p1', reason: 'x', changedByUserId: 'u1'
    })).rejects.toThrow('NOT_FOUND');
  });

  it('records "inherited" in audit when clearing a null rate', async () => {
    const prisma = makePrisma({ id: 'o1', partnerCommissionRate: null });
    await clearOrgCommissionRate(prisma, {
      organizationId: 'o1', partnerId: 'p1', reason: 'reset', changedByUserId: 'u1'
    });
    const [, auditArgs] = recordAuditMock.mock.calls[0];
    expect(auditArgs.before.rate).toBe('inherited');
    expect(auditArgs.after.rate).toBe('cleared');
  });

  it('records existing rate string in audit when clearing a set rate', async () => {
    const existingRate = { toString: () => '0.10' };
    const prisma = makePrisma({ id: 'o1', partnerCommissionRate: existingRate });
    await clearOrgCommissionRate(prisma, {
      organizationId: 'o1', partnerId: 'p1', reason: 'clean', changedByUserId: 'u1'
    });
    const [, auditArgs] = recordAuditMock.mock.calls[0];
    expect(auditArgs.before.rate).toBe('0.10');
  });
});
