/**
 * Unit tests for src/lib/services/partner/dashboard.ts
 * Covers branches missed by the integration tests (which require live PG).
 */
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { kpis, attention, recentEvents } from '@/lib/services/partner/dashboard';

vi.mock('@/lib/format', () => ({
  fmtMoney: (n: number) => `${n.toFixed(2)} ₽`
}));

function dec(n: number) {
  return new Prisma.Decimal(n);
}

// Helper to build a prisma mock with configurable results
function makePrisma(overrides: Record<string, any> = {}) {
  return {
    partner: {
      findUnique: vi.fn().mockResolvedValue({ commissionRate: dec(0.1) })
    },
    order: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: null, paidAmount: null } })
    },
    lead: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([])
    },
    payment: {
      findMany: vi.fn().mockResolvedValue([])
    },
    ...overrides
  } as any;
}

describe('kpis — unit', () => {
  it('handles missing partner (commissionRate defaults to 0)', async () => {
    const prisma = makePrisma({
      partner: { findUnique: vi.fn().mockResolvedValue(null) },
      order: {
        count: vi.fn().mockResolvedValue(2),
        // outstanding теперь считается SQL-агрегатом (R2)
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: dec(1000), paidAmount: dec(200) } }),
        findMany: vi.fn()
          .mockResolvedValueOnce([{ totalAmount: dec(500), organization: { partnerCommissionRate: null } }]) // paidThisMonth
      },
      lead: { count: vi.fn().mockResolvedValue(3) }
    });

    const result = await kpis(prisma, { partnerId: 'p1', scopeOrgIds: [] });
    expect(result.openOrders).toBe(2);
    expect(result.outstanding).toBe('800.00');
    expect(result.activeLeads).toBe(3);
    // rate = 0, so commission = 0
    expect(result.commissionThisMonth).toBe('0.00');
  });

  it('applies scopeOrgIds narrowing to order where clause', async () => {
    const prisma = makePrisma();
    await kpis(prisma, { partnerId: 'p1', scopeOrgIds: ['org1', 'org2'] });
    const where = prisma.order.count.mock.calls[0][0].where;
    expect(where.organizationId).toEqual({ in: ['org1', 'org2'] });
  });

  it('does NOT add organizationId to where when scopeOrgIds is empty', async () => {
    const prisma = makePrisma();
    await kpis(prisma, { partnerId: 'p1', scopeOrgIds: [] });
    const where = prisma.order.count.mock.calls[0][0].where;
    expect(where.organizationId).toBeUndefined();
  });

  it('correctly computes commissionThisMonth = sum(totalAmount) * rate', async () => {
    const prisma = makePrisma({
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: dec(0.1) }) },
      order: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: null, paidAmount: null } }),
        findMany: vi.fn()
          .mockResolvedValueOnce([
            { totalAmount: dec(10000), organization: { partnerCommissionRate: null } },
            { totalAmount: dec(5000), organization: { partnerCommissionRate: null } }
          ]) // paidThisMonth
      },
      lead: { count: vi.fn().mockResolvedValue(0) }
    });
    const result = await kpis(prisma, { partnerId: 'p1', scopeOrgIds: [] });
    expect(result.commissionThisMonth).toBe('1500.00');
  });

  it('applies the per-org override rate over the partner default (§6.2 priority)', async () => {
    const prisma = makePrisma({
      partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: dec(0.1) }) },
      order: {
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: null, paidAmount: null } }),
        findMany: vi.fn()
          .mockResolvedValueOnce([
            { totalAmount: dec(10000), organization: { partnerCommissionRate: dec(0.2) } }, // договорная скидка
            { totalAmount: dec(5000), organization: { partnerCommissionRate: null } } // дефолт партнёра
          ]) // paidThisMonth
      },
      lead: { count: vi.fn().mockResolvedValue(0) }
    });
    const result = await kpis(prisma, { partnerId: 'p1', scopeOrgIds: [] });
    // 10000×0.2 + 5000×0.1 = 2500
    expect(result.commissionThisMonth).toBe('2500.00');
  });
});

describe('attention — unit', () => {
  it('returns empty arrays when no stuck/overdue/stale', async () => {
    const prisma = makePrisma({
      order: { findMany: vi.fn().mockResolvedValue([]) },
      lead: { findMany: vi.fn().mockResolvedValue([]) }
    });
    const result = await attention(prisma, { partnerId: 'p1', scopeOrgIds: [] });
    expect(result.stuckOrders).toEqual([]);
    expect(result.overdueOrders).toEqual([]);
    expect(result.staleLeads).toEqual([]);
  });

  it('maps stuckOrders with formatted amounts', async () => {
    const prisma = makePrisma({
      order: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{
            id: 'o1', title: 'Stuck', updatedAt: new Date('2024-01-01'),
            deadline: null, totalAmount: dec(5000), paidAmount: dec(1000)
          }])
          .mockResolvedValueOnce([]) // overdue
      },
      lead: { findMany: vi.fn().mockResolvedValue([]) }
    });
    const result = await attention(prisma, { partnerId: 'p1', scopeOrgIds: [] });
    expect(result.stuckOrders).toHaveLength(1);
    expect(result.stuckOrders[0].totalAmount).toBe('5000.00');
    expect(result.stuckOrders[0].paidAmount).toBe('1000.00');
  });

  it('maps overdueOrders with formatted amounts', async () => {
    const prisma = makePrisma({
      order: {
        findMany: vi.fn()
          .mockResolvedValueOnce([]) // stuck — empty
          .mockResolvedValueOnce([{
            id: 'o2', title: 'Overdue', updatedAt: new Date('2024-02-01'),
            deadline: new Date('2024-01-01'), totalAmount: dec(8000), paidAmount: dec(2000)
          }]) // overdue
      },
      lead: { findMany: vi.fn().mockResolvedValue([]) }
    });
    const result = await attention(prisma, { partnerId: 'p1', scopeOrgIds: [] });
    expect(result.overdueOrders).toHaveLength(1);
    expect(result.overdueOrders[0].totalAmount).toBe('8000.00');
    expect(result.overdueOrders[0].paidAmount).toBe('2000.00');
  });

  it('applies scopeOrgIds narrowing in attention where clause', async () => {
    const prisma = makePrisma({
      order: { findMany: vi.fn().mockResolvedValue([]) },
      lead: { findMany: vi.fn().mockResolvedValue([]) }
    });
    await attention(prisma, { partnerId: 'p1', scopeOrgIds: ['org1'] });
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toEqual({ in: ['org1'] });
  });
});

describe('recentEvents — unit', () => {
  it('returns empty array for a partner with no data', async () => {
    const prisma = makePrisma({
      order: { findMany: vi.fn().mockResolvedValue([]) },
      lead: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) }
    });
    const events = await recentEvents(prisma, { partnerId: 'p1', scopeOrgIds: [] }, 10);
    expect(events).toEqual([]);
  });

  it('generates order_updated event with ref', async () => {
    const prisma = makePrisma({
      order: { findMany: vi.fn().mockResolvedValue([{ id: 'o1', title: 'Заказ', updatedAt: new Date('2024-05-01') }]) },
      lead: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) }
    });
    const events = await recentEvents(prisma, { partnerId: 'p1', scopeOrgIds: [] }, 10);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('order_updated');
    expect(events[0].ref).toEqual({ kind: 'order', id: 'o1' });
  });

  it('generates lead_created event with ref', async () => {
    const prisma = makePrisma({
      order: { findMany: vi.fn().mockResolvedValue([]) },
      lead: { findMany: vi.fn().mockResolvedValue([{
        id: 'l1', clientCompanyName: 'ООО', subject: 'Обучение', createdAt: new Date('2024-06-01')
      }]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) }
    });
    const events = await recentEvents(prisma, { partnerId: 'p1', scopeOrgIds: [] }, 10);
    expect(events[0].kind).toBe('lead_created');
    expect(events[0].ref).toEqual({ kind: 'lead', id: 'l1' });
    expect(events[0].title).toContain('ООО');
  });

  it('generates payment_received event with order ref when order is present', async () => {
    const prisma = makePrisma({
      order: { findMany: vi.fn().mockResolvedValue([]) },
      lead: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([{
        id: 'pay1', amount: { toFixed: () => '500.00' }, createdAt: new Date('2024-07-01'),
        order: { id: 'o1', title: 'Заказ' },
        organization: { id: 'org1', name: 'ООО Тест' }
      }]) }
    });
    const events = await recentEvents(prisma, { partnerId: 'p1', scopeOrgIds: [] }, 10);
    expect(events[0].kind).toBe('payment_received');
    expect(events[0].ref).toEqual({ kind: 'order', id: 'o1' });
    expect(events[0].title).toContain('Заказ');
  });

  it('generates order-less payment event WITHOUT ref when order is null', async () => {
    const prisma = makePrisma({
      order: { findMany: vi.fn().mockResolvedValue([]) },
      lead: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([{
        id: 'pay2', amount: { toFixed: () => '300.00' }, createdAt: new Date('2024-08-01'),
        order: null,
        organization: { id: 'org2', name: 'ООО Без Заказа' }
      }]) }
    });
    const events = await recentEvents(prisma, { partnerId: 'p1', scopeOrgIds: [] }, 10);
    expect(events[0].kind).toBe('payment_received');
    expect(events[0].ref).toBeUndefined();
    expect(events[0].title).toContain('ООО Без Заказа');
  });

  it('respects limit when sorting and slicing', async () => {
    const orders = Array.from({ length: 5 }, (_, i) => ({
      id: `o${i}`, title: `Заказ ${i}`, updatedAt: new Date(2024, 0, i + 1)
    }));
    const prisma = makePrisma({
      order: { findMany: vi.fn().mockResolvedValue(orders) },
      lead: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) }
    });
    const events = await recentEvents(prisma, { partnerId: 'p1', scopeOrgIds: [] }, 3);
    expect(events).toHaveLength(3);
  });

  it('applies scopeOrgIds narrowing to order where clause in recentEvents', async () => {
    const prisma = makePrisma({
      order: { findMany: vi.fn().mockResolvedValue([]) },
      lead: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) }
    });
    await recentEvents(prisma, { partnerId: 'p1', scopeOrgIds: ['org1'] }, 10);
    const where = prisma.order.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toEqual({ in: ['org1'] });
  });

  it('applies scopeOrgIds narrowing to payment org where clause', async () => {
    const prisma = makePrisma({
      order: { findMany: vi.fn().mockResolvedValue([]) },
      lead: { findMany: vi.fn().mockResolvedValue([]) },
      payment: { findMany: vi.fn().mockResolvedValue([]) }
    });
    await recentEvents(prisma, { partnerId: 'p1', scopeOrgIds: ['org1'] }, 10);
    const where = prisma.payment.findMany.mock.calls[0][0].where;
    expect(where.organization.id).toEqual({ in: ['org1'] });
  });
});
