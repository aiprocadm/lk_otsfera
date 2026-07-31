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
    // F4: обе мутации пишут append-only историю ставки внутри транзакции.
    organizationCommissionRateChange: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn() },
  } as any;
}

function makePrisma(org: object | null) {
  const tx = makeTx();
  return {
    organization: { findFirst: vi.fn().mockResolvedValue(org) },
    $transaction: vi.fn().mockImplementation((cb: (arg: unknown) => unknown) => cb(tx)),
    _tx: tx,
  } as any;
}

describe('setOrgCommissionRate — unit', () => {
  beforeEach(() => {
    recordAuditMock.mockReset().mockResolvedValue(undefined);
  });

  it('returns rate_out_of_range for negative rate', async () => {
    const res = await setOrgCommissionRate(makePrisma(null), {
      organizationId: 'o1',
      partnerId: 'p1',
      newRate: -0.1,
      reason: 'x',
      changedByUserId: 'u1',
    });
    expect(res).toEqual({ ok: false, error: 'rate_out_of_range' });
  });

  it('returns rate_out_of_range for rate >= 1', async () => {
    const res = await setOrgCommissionRate(makePrisma(null), {
      organizationId: 'o1',
      partnerId: 'p1',
      newRate: 1,
      reason: 'x',
      changedByUserId: 'u1',
    });
    expect(res).toEqual({ ok: false, error: 'rate_out_of_range' });
  });

  it('returns not_found when org not under partner', async () => {
    const res = await setOrgCommissionRate(makePrisma(null), {
      organizationId: 'o1',
      partnerId: 'p1',
      newRate: 0.1,
      reason: 'x',
      changedByUserId: 'u1',
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('records "inherited" in audit before.rate when existing rate is null', async () => {
    const prisma = makePrisma({ id: 'o1', partnerCommissionRate: null });
    const res = await setOrgCommissionRate(prisma, {
      organizationId: 'o1',
      partnerId: 'p1',
      newRate: 0.08,
      reason: 'VIP',
      changedByUserId: 'u1',
    });
    expect(res.ok).toBe(true);
    const [, auditArgs] = recordAuditMock.mock.calls[0];
    expect(auditArgs.before.rate).toBe('inherited');
    expect(auditArgs.after.rate).toBe('0.08');
  });

  it('records existing rate in audit before.rate when rate is set', async () => {
    const existingRate = { toString: () => '0.05' };
    const prisma = makePrisma({ id: 'o1', partnerCommissionRate: existingRate });
    const res = await setOrgCommissionRate(prisma, {
      organizationId: 'o1',
      partnerId: 'p1',
      newRate: 0.08,
      reason: 'Upgrade',
      changedByUserId: 'u1',
    });
    expect(res.ok).toBe(true);
    const [, auditArgs] = recordAuditMock.mock.calls[0];
    expect(auditArgs.before.rate).toBe('0.05');
    expect(auditArgs.after.rate).toBe('0.08');
  });

  it('F4: appends a history row with oldRate=previous and newRate=set value', async () => {
    const existingRate = { toString: () => '0.05' };
    const prisma = makePrisma({ id: 'o1', partnerCommissionRate: existingRate });
    await setOrgCommissionRate(prisma, {
      organizationId: 'o1',
      partnerId: 'p1',
      newRate: 0.08,
      reason: 'Upgrade',
      changedByUserId: 'u1',
    });
    expect(prisma._tx.organizationCommissionRateChange.create).toHaveBeenCalledWith({
      data: { organizationId: 'o1', oldRate: existingRate, newRate: 0.08, changedById: 'u1' },
    });
  });
});

describe('clearOrgCommissionRate — unit', () => {
  beforeEach(() => {
    recordAuditMock.mockReset().mockResolvedValue(undefined);
  });

  it('returns not_found when org not under partner', async () => {
    const res = await clearOrgCommissionRate(makePrisma(null), {
      organizationId: 'o1',
      partnerId: 'p1',
      reason: 'x',
      changedByUserId: 'u1',
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('records "inherited" in audit when clearing a null rate', async () => {
    const prisma = makePrisma({ id: 'o1', partnerCommissionRate: null });
    const res = await clearOrgCommissionRate(prisma, {
      organizationId: 'o1',
      partnerId: 'p1',
      reason: 'reset',
      changedByUserId: 'u1',
    });
    expect(res.ok).toBe(true);
    const [, auditArgs] = recordAuditMock.mock.calls[0];
    expect(auditArgs.before.rate).toBe('inherited');
    expect(auditArgs.after.rate).toBe('cleared');
  });

  it('records existing rate string in audit when clearing a set rate', async () => {
    const existingRate = { toString: () => '0.10' };
    const prisma = makePrisma({ id: 'o1', partnerCommissionRate: existingRate });
    const res = await clearOrgCommissionRate(prisma, {
      organizationId: 'o1',
      partnerId: 'p1',
      reason: 'clean',
      changedByUserId: 'u1',
    });
    expect(res.ok).toBe(true);
    const [, auditArgs] = recordAuditMock.mock.calls[0];
    expect(auditArgs.before.rate).toBe('0.10');
  });

  it('F4: appends a clear-event history row (newRate=null)', async () => {
    const existingRate = { toString: () => '0.10' };
    const prisma = makePrisma({ id: 'o1', partnerCommissionRate: existingRate });
    await clearOrgCommissionRate(prisma, {
      organizationId: 'o1',
      partnerId: 'p1',
      reason: 'clean',
      changedByUserId: 'u1',
    });
    expect(prisma._tx.organizationCommissionRateChange.create).toHaveBeenCalledWith({
      data: { organizationId: 'o1', oldRate: existingRate, newRate: null, changedById: 'u1' },
    });
  });
});
