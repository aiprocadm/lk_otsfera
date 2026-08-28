/**
 * Unit tests for src/lib/services/partner/orgDocuments.ts
 * Covers the early-return branches and type filter.
 */
import { describe, it, expect, vi } from 'vitest';
import { getOrgDocuments } from '@/lib/services/partner/orgDocuments';

vi.mock('@/lib/auth/documentChannelPolicy', () => ({
  // `У-155`: вкладка берёт ОБА канала — партнёрский и организации.
  partnerPortfolioDocumentsWhere: vi.fn(() => ({
    OR: [
      { counterpartyType: 'partner', counterpartyId: 'p1' },
      { counterpartyType: 'organization', counterpartyId: 'org1' },
    ],
    scanStatus: { not: 'infected' },
  })),
}));

function makeOrg(opts: { partnerId?: string; companyId?: string | null } = {}) {
  return {
    partnerId: opts.partnerId ?? 'p1',
    companyId: opts.companyId !== undefined ? opts.companyId : 'co1',
  };
}

function makePrisma(org: object | null, docs: object[] = [], counts: object[] = []) {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue(org) },
    document: {
      findMany: vi.fn().mockResolvedValue(docs),
      groupBy: vi.fn().mockResolvedValue(counts),
    },
  } as any;
}

describe('getOrgDocuments — unit', () => {
  it('returns empty result when org not found', async () => {
    const prisma = makePrisma(null);
    const result = await getOrgDocuments(prisma, { orgId: 'x', partnerId: 'p1' });
    expect(result).toEqual({ rows: [], countsByType: {}, total: 0 });
  });

  it('returns empty result when org belongs to another partner', async () => {
    const prisma = makePrisma(makeOrg({ partnerId: 'other-partner' }));
    const result = await getOrgDocuments(prisma, { orgId: 'org1', partnerId: 'p1' });
    expect(result).toEqual({ rows: [], countsByType: {}, total: 0 });
    // Document queries should NOT have run
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });

  it('returns empty result when org has no companyId', async () => {
    const prisma = makePrisma(makeOrg({ companyId: null }));
    const result = await getOrgDocuments(prisma, { orgId: 'org1', partnerId: 'p1' });
    expect(result).toEqual({ rows: [], countsByType: {}, total: 0 });
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });

  it('returns mapped rows and countsByType when org is valid', async () => {
    const docs = [
      {
        id: 'd1',
        name: 'file.pdf',
        type: 'contract',
        direction: 'incoming',
        signedAt: null,
        createdAt: new Date('2024-01-01'),
        size: 100,
        orderId: 'o1',
        order: { orderNumber: 'N001', title: 'Заказ 1' },
      },
    ];
    const counts = [{ type: 'contract', _count: { _all: 1 } }];
    const prisma = makePrisma(makeOrg(), docs, counts);
    const result = await getOrgDocuments(prisma, { orgId: 'org1', partnerId: 'p1' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].orderNumber).toBe('N001');
    expect(result.rows[0].orderTitle).toBe('Заказ 1');
    expect(result.countsByType.contract).toBe(1);
    expect(result.total).toBe(1);
  });

  it('maps order=null in doc to null orderNumber/orderTitle', async () => {
    const docs = [
      {
        id: 'd2',
        name: 'file2.pdf',
        type: 'other',
        direction: 'outgoing',
        signedAt: null,
        createdAt: new Date('2024-02-01'),
        size: 50,
        orderId: null,
        order: null,
      },
    ];
    const counts = [{ type: 'other', _count: { _all: 1 } }];
    const prisma = makePrisma(makeOrg(), docs, counts);
    const result = await getOrgDocuments(prisma, { orgId: 'org1', partnerId: 'p1' });
    expect(result.rows[0].orderNumber).toBeNull();
    expect(result.rows[0].orderTitle).toBeNull();
  });

  it('applies type filter when provided', async () => {
    const prisma = makePrisma(makeOrg(), [], []);
    await getOrgDocuments(prisma, { orgId: 'org1', partnerId: 'p1', type: 'act' });
    const findManyWhere = prisma.document.findMany.mock.calls[0][0].where;
    expect(findManyWhere.type).toBe('act');
  });
});
