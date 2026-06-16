/**
 * Unit tests for src/lib/services/partner/deals.ts
 * Covers branches missed by the integration-only f2f8 test.
 */
import { describe, it, expect, vi } from 'vitest';
import { listPartnerDeals } from '@/lib/services/partner/deals';

// Minimal Decimal-like with toFixed
function dec(n: number) {
  return { toFixed: (d: number) => n.toFixed(d), toString: () => String(n) };
}

function makePrisma(orders: object[], total = orders.length) {
  return {
    order: {
      count: vi.fn().mockResolvedValue(total),
      findMany: vi.fn().mockResolvedValue(orders)
    }
  } as any;
}

const baseOrder = {
  id: 'o1',
  orderNumber: 'N1',
  title: 'Заказ',
  totalAmount: dec(1000),
  paidAmount: dec(200),
  executionStatus: 'in_progress' as const,
  financialStatus: 'billed' as const,
  createdAt: new Date('2024-01-01'),
  deadline: null,
  closedAt: null,
  organization: { id: 'org1', name: 'ООО Тест' }
};

describe('listPartnerDeals — unit', () => {
  it('returns mapped rows with organization name and id', async () => {
    const prisma = makePrisma([baseOrder]);
    const result = await listPartnerDeals(prisma, {
      partnerId: 'p1',
      take: 10,
      skip: 0
    });
    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      id: 'o1',
      totalAmount: '1000.00',
      paidAmount: '200.00',
      debt: '800.00',
      organizationName: 'ООО Тест',
      organizationId: 'org1'
    });
  });

  it('uses fallback "—" and null orgId when organization is null', async () => {
    const orderNoOrg = { ...baseOrder, organization: null };
    const prisma = makePrisma([orderNoOrg]);
    const result = await listPartnerDeals(prisma, { partnerId: 'p1', take: 10, skip: 0 });
    expect(result.rows[0].organizationName).toBe('—');
    expect(result.rows[0].organizationId).toBeNull();
  });

  it('applies scopeOrgIds filter to where clause', async () => {
    const prisma = makePrisma([]);
    await listPartnerDeals(prisma, {
      partnerId: 'p1',
      scopeOrgIds: ['org1', 'org2'],
      take: 10,
      skip: 0
    });
    const whereArg = prisma.order.findMany.mock.calls[0][0].where;
    expect(whereArg.organizationId).toEqual({ in: ['org1', 'org2'] });
  });

  it('does NOT add organizationId filter when scopeOrgIds is empty', async () => {
    const prisma = makePrisma([]);
    await listPartnerDeals(prisma, {
      partnerId: 'p1',
      scopeOrgIds: [],
      take: 10,
      skip: 0
    });
    const whereArg = prisma.order.findMany.mock.calls[0][0].where;
    expect(whereArg.organizationId).toBeUndefined();
  });

  it('applies executionStatus filter when provided', async () => {
    const prisma = makePrisma([]);
    await listPartnerDeals(prisma, {
      partnerId: 'p1',
      executionStatus: 'completed',
      take: 10,
      skip: 0
    });
    const whereArg = prisma.order.findMany.mock.calls[0][0].where;
    expect(whereArg.executionStatus).toBe('completed');
  });

  it('applies financialStatus filter when provided', async () => {
    const prisma = makePrisma([]);
    await listPartnerDeals(prisma, {
      partnerId: 'p1',
      financialStatus: 'paid',
      take: 10,
      skip: 0
    });
    const whereArg = prisma.order.findMany.mock.calls[0][0].where;
    expect(whereArg.financialStatus).toBe('paid');
  });

  it('applies search OR filter when search is provided', async () => {
    const prisma = makePrisma([]);
    await listPartnerDeals(prisma, {
      partnerId: 'p1',
      search: 'тест',
      take: 10,
      skip: 0
    });
    const whereArg = prisma.order.findMany.mock.calls[0][0].where;
    expect(whereArg.OR).toBeDefined();
    expect(whereArg.OR).toHaveLength(2);
    expect(whereArg.OR[0]).toMatchObject({ title: { contains: 'тест', mode: 'insensitive' } });
    expect(whereArg.OR[1]).toMatchObject({ orderNumber: { contains: 'тест', mode: 'insensitive' } });
  });

  it('returns empty rows and zero total when no orders found', async () => {
    const prisma = makePrisma([], 0);
    const result = await listPartnerDeals(prisma, { partnerId: 'p1', take: 10, skip: 0 });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });
});
