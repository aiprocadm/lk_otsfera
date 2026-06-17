/**
 * Unit tests for src/lib/services/manager/orders.ts
 * Covers branches not exercised by the existing integration test or override test:
 *   - listOrders: executionStatus/financialStatus/organizationId/q filters
 *   - listOrders: cursor branch, pagination (hasMore, sliced, nextCursor)
 *   - getOrder: null order, leaderSameCompany=true, canSeeOrder=false
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, canSeeOrder, isLeaderSameCompany } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrder: vi.fn(),
  isLeaderSameCompany: vi.fn()
}));

vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  canSeeOrder,
  isLeaderSameCompany,
  managerOrderScope: vi.fn().mockReturnValue({})
}));

import { listOrders, getOrder } from '@/lib/services/manager/orders';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1'
};

function fakePrisma(rows: unknown[] = []) {
  return {
    order: {
      findMany: vi.fn().mockResolvedValue(rows),
      findUnique: vi.fn().mockResolvedValue(null)
    },
    company: { findUnique: vi.fn() }
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrder.mockReturnValue(true);
  isLeaderSameCompany.mockReturnValue(false);
});

// ─── listOrders — filter branches ─────────────────────────────────────────────

describe('listOrders — filter branches', () => {
  it('adds executionStatus filter when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { order: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listOrders(p, { session: SESSION, executionStatus: 'in_progress' });
    const where = findMany.mock.calls[0][0].where;
    const filters = where.AND;
    expect(filters).toContainEqual({ executionStatus: 'in_progress' });
  });

  it('adds financialStatus filter when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { order: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listOrders(p, { session: SESSION, financialStatus: 'paid' });
    const where = findMany.mock.calls[0][0].where;
    const filters = where.AND;
    expect(filters).toContainEqual({ financialStatus: 'paid' });
  });

  it('adds organizationId filter when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { order: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listOrders(p, { session: SESSION, organizationId: 'org-x' });
    const where = findMany.mock.calls[0][0].where;
    const filters = where.AND;
    expect(filters).toContainEqual({ organizationId: 'org-x' });
  });

  it('adds search (q) filter with OR when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { order: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listOrders(p, { session: SESSION, q: 'тест' });
    const where = findMany.mock.calls[0][0].where;
    const filters = where.AND;
    expect(filters).toContainEqual({
      OR: [
        { title: { contains: 'тест', mode: 'insensitive' } },
        { orderNumber: { contains: 'тест', mode: 'insensitive' } }
      ]
    });
  });

  it('passes cursor and skip when cursor provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { order: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listOrders(p, { session: SESSION, cursor: 'cur-1' });
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toEqual({ id: 'cur-1' });
    expect(call.skip).toBe(1);
  });

  it('does not pass cursor when not provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { order: { findMany }, company: { findUnique: vi.fn() } } as never;
    await listOrders(p, { session: SESSION });
    const call = findMany.mock.calls[0][0];
    expect(call.cursor).toBeUndefined();
  });

  it('paginates: returns nextCursor when more rows than take', async () => {
    // take=2, return 3 rows → hasMore=true
    const rows = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
    const findMany = vi.fn().mockResolvedValue(rows);
    const p = { order: { findMany }, company: { findUnique: vi.fn() } } as never;
    const result = await listOrders(p, { session: SESSION, take: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBe('r2');
  });

  it('returns nextCursor=null when rows count equals take (no more)', async () => {
    const rows = [{ id: 'r1' }, { id: 'r2' }];
    const findMany = vi.fn().mockResolvedValue(rows);
    const p = { order: { findMany }, company: { findUnique: vi.fn() } } as never;
    const result = await listOrders(p, { session: SESSION, take: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });
});

// ─── getOrder ──────────────────────────────────────────────────────────────────

describe('getOrder', () => {
  it('returns null when order not found', async () => {
    const p = fakePrisma();
    const result = await getOrder(p, SESSION, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when canSeeOrder=false and not leaderSameCompany', async () => {
    canSeeOrder.mockReturnValue(false);
    isLeaderSameCompany.mockReturnValue(false);
    const order = {
      id: 'ord-1', managerId: 'other', organizationId: 'org-1', companyId: 'co-1',
      comments: [], _count: { comments: 0 }
    };
    const findUnique = vi.fn().mockResolvedValue(order);
    const p = { order: { findMany: vi.fn(), findUnique } } as never;
    const result = await getOrder(p, SESSION, 'ord-1');
    expect(result).toBeNull();
  });

  it('returns order when leaderSameCompany=true (skips canSeeOrder check)', async () => {
    isLeaderSameCompany.mockReturnValue(true);
    canSeeOrder.mockReturnValue(false); // would block if checked
    const order = {
      id: 'ord-1', managerId: 'other', organizationId: 'org-1', companyId: 'co-1',
      title: 'Test', orderNumber: 'O-1', executionStatus: 'pending',
      comments: [{ id: 'c-1' }], _count: { comments: 1 },
      documents: [], payments: [], manager: null, organization: null
    };
    const findUnique = vi.fn().mockResolvedValue(order);
    const p = { order: { findMany: vi.fn(), findUnique } } as never;
    const result = await getOrder(p, SESSION, 'ord-1');
    expect(result).not.toBeNull();
    expect(result!.commentsCountByMe).toBe(1);
    // canSeeOrder was NOT called (leaderSameCompany short-circuits)
    expect(canSeeOrder).not.toHaveBeenCalled();
  });

  it('returns order when canSeeOrder=true (normal path)', async () => {
    isLeaderSameCompany.mockReturnValue(false);
    canSeeOrder.mockReturnValue(true);
    const order = {
      id: 'ord-1', managerId: 'mgr-1', organizationId: 'org-1', companyId: 'co-1',
      title: 'Test', orderNumber: 'O-1', executionStatus: 'pending',
      comments: [], _count: { comments: 0 },
      documents: [], payments: [], manager: null, organization: null
    };
    const findUnique = vi.fn().mockResolvedValue(order);
    const p = { order: { findMany: vi.fn(), findUnique } } as never;
    const result = await getOrder(p, SESSION, 'ord-1');
    expect(result).not.toBeNull();
    expect(result!.commentsCountByMe).toBe(0);
  });
});
