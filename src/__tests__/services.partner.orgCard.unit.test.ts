/**
 * Unit tests for src/lib/services/partner/orgCard.ts
 * Covers the branches missed by the integration test.
 */
import { describe, it, expect, vi } from 'vitest';
import { getOrgCard } from '@/lib/services/partner/orgCard';

function dec(n: number) {
  return { toFixed: (d: number) => n.toFixed(d), toString: () => String(n) };
}

function makePrisma(org: object | null, orders: object[] = []) {
  return {
    organization: { findFirst: vi.fn().mockResolvedValue(org) },
    order: { findMany: vi.fn().mockResolvedValue(orders) }
  } as any;
}

const baseOrg = {
  id: 'org1', name: 'ООО Тест', inn: '7700000001', kpp: null,
  assignedManagerUserId: null,
  partnerCommissionRate: { toString: () => '0.05' },
  partnerCommissionRateNote: 'VIP',
  companyId: 'co1',
  company: { name: 'Компания Холдинг' }
};

describe('getOrgCard — unit', () => {
  it('returns null when org not found or belongs to another partner', async () => {
    const prisma = makePrisma(null);
    const result = await getOrgCard(prisma, { orgId: 'x', partnerId: 'p1' });
    expect(result).toBeNull();
  });

  it('returns org card with legalName from company when companyId is set', async () => {
    const prisma = makePrisma(baseOrg, [
      { totalAmount: dec(1000), paidAmount: dec(200), executionStatus: 'in_progress' },
      { totalAmount: dec(500), paidAmount: dec(500), executionStatus: 'cancelled' }
    ]);
    const result = await getOrgCard(prisma, { orgId: 'org1', partnerId: 'p1' });
    expect(result).not.toBeNull();
    expect(result!.legalName).toBe('Компания Холдинг');
    expect(result!.partnerCommissionRate).toBe('0.05');
    // ordersCount = 2, but debt excludes cancelled
    expect(result!.kpi.ordersCount).toBe(2);
    expect(result!.kpi.debt).toBe('800.00'); // 1000-200 = 800 (cancelled excluded)
  });

  it('returns legalName=null when org has no company relation', async () => {
    const orgNoCompany = { ...baseOrg, company: null };
    const prisma = makePrisma(orgNoCompany, []);
    const result = await getOrgCard(prisma, { orgId: 'org1', partnerId: 'p1' });
    expect(result!.legalName).toBeNull();
  });

  it('skips order query and returns zero kpi when companyId is null', async () => {
    const orgNoCompany = { ...baseOrg, companyId: null, company: null };
    const prisma = makePrisma(orgNoCompany);
    const result = await getOrgCard(prisma, { orgId: 'org1', partnerId: 'p1' });
    expect(result).not.toBeNull();
    expect(result!.kpi.ordersCount).toBe(0);
    expect(result!.kpi.debt).toBe('0.00');
    // Order query should NOT have been called
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('returns partnerCommissionRate=null when rate field is null', async () => {
    const orgNoRate = { ...baseOrg, partnerCommissionRate: null };
    const prisma = makePrisma(orgNoRate, []);
    const result = await getOrgCard(prisma, { orgId: 'org1', partnerId: 'p1' });
    expect(result!.partnerCommissionRate).toBeNull();
  });
});
